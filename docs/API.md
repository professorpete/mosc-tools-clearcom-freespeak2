# Clear-Com FreeSpeak II Base II — CCM API (reverse-engineered)

Source: official firmware `FSII-BASE-II_Firmware_v1.6.15.zip` →
`v1.6.15.ext3` (ext3 rootfs) → `/var/web/app/scripts/scripts.082c856c.js`
(the CCM AngularJS frontend). The server itself is `/var/web/.server.enc`
(license-encrypted, CodeMeter/Wibu), but the frontend declares every route
it calls, so the API surface is fully recoverable.

## Transport & auth

- Node.js/Express + socket.io **1.6.0** on the base station.
- **HTTP Basic authentication.** The logout routine calls
  `xhr.open("GET","/",true,"admin","logout")` to poison the cached
  credentials — confirming Basic auth, not a token/session scheme.
- Default credentials `admin` / `admin`.
- Base URL is just the base station IP, port 80.
- API version segment is `1` (`version:1` default in the `$resource` defs);
  a few device calls use `/api/2/`.

## Routes used by the CCM

### Devices
```
GET    /api/1/devices/
GET    /api/:version/devices/:deviceId
PUT    /api/:version/devices/:deviceId
POST   /api/:version/devices/:deviceId/:action
POST   /api/2/devices/:deviceId/:action
GET    /api/:version/devices/:deviceId/capability
```
Known device `:action` values (from the `Device` `$resource` factory):
`reboot`, `resettodefault`, `otastate`, `setGPO`, `setGPI`,
`setDateTime`, `getDateTime`, `setNetMode`, `wibuRetry`.

### Endpoints (beltpacks, wired stations, Agent-IC)
```
GET    /api/:version/devices/:deviceId/endpoints/:endpointId
PUT    /api/:version/devices/:deviceId/endpoints/:endpointId
POST   /api/:version/devices/:deviceId/endpoints/:endpointId/rmk
POST   /api/:version/devices/:deviceId/endpoints/:endpointId/call
POST   /api/:version/devices/:deviceId/endpoints/:endpointId/reboot
POST   /api/:version/devices/:deviceId/endpoints/:endpointId/resettodefault
```

**This is the kill switch.** Frontend implementation:

```js
ea.triggerRMK = function (a) {
  a.id ? a.rmkPress = true : (ea.rmkAll = true, a.device_id = 1);
  y.rmkEndpoint(a.device_id, a.id)...
};
rmkEndpoint = function (a, b) {
  return this.endpointsResource.rmk({deviceId: a, endpointId: b}, {}).$promise;
};
```

Semantics:
- **`endpointId` omitted → system-wide RMK** (all beltpacks + wired
  stations), and `device_id` defaults to `1`. This is the "RMK All" button
  on the CCM Overview page.
- `endpointId` supplied → RMK that single endpoint.
- Empty POST body `{}`.
- The UI holds the pressed state for 3000 ms, which is a good debounce
  reference.

RMK unlatches every latched talk key. It is the same function as the
front-panel RMK key, which the manual describes as letting the operator
"remotely unlatch all beltpack talk keys, wireless and wired"
(FSII-BASE-II User Guide).

Note: RMK unlatches *latched* keys. A user physically holding a
non-latching talk key (PTT) is not silenced by RMK — that is a protocol
limitation, not a module limitation. See the hard-cut strategies below.

### GPIO (hard audio cut path)
```
POST   /api/1/devices/:deviceId/setGPO    body: {id, enabled}
POST   /api/1/devices/:deviceId/setGPI    body: {id, enabled}
GET    /api/1/devices/0/gpio
GET/PUT/DELETE /api/1/devices/:deviceId/gpo/:gpoId/:action
GET/PUT/DELETE /api/1/devices/:deviceId/gpi/:gpiId/:action
       /api/1/devices/:deviceId/gpo/:gpoId/events/:eventId
       /api/1/devices/:deviceId/gpi/:gpiId/events/:eventId
```
Frontend: `M.setGPO({version:"1", deviceId:a, action:"setGPO"}, {id:b.id, enabled:d})`.
`enabled: null` releases a forced override back to normal operation —
the UI sends `null` when the GPIO is already forced to the target state.

FSII Base II v1.5.1+ exposes **6 configurable GPIOs (2 GPI, 4 GPO)**
(Clear-Com GPIO documentation). Driving a GPO relay into an external mute/kill
input is the only way to guarantee a true audio cut regardless of key latch
state.

### Interfaces & ports (per-port gain, another hard-cut path)
```
GET/PUT /api/1/devices/:deviceId/interfaces/:interfaceId
PUT     /api/1/devices/:deviceId/interfaces/:interfaceId/ports/:portId
POST    /api/1/devices/:deviceId/interfaces/:interfaceId/ports/:portId/:action
        .../ports/:portId/calls/:callId
```
Ports carry `inputGain` / `outputGain`. Valid steps depend on interface type:
- `2W`: `3,2,1,0,-1,-2,-3` dB
- `4W`/`4WG`/`IVC`/`E1`/`SIP`: `12,9,6,3,0,-3,-6,-9,-12` dB
  (HMS-4X: `12,6,0,-6,-12`)

Setting output gain to minimum is a *reduction*, not a true mute — the module
therefore treats gain as "duck/attenuate", and stores the prior value so it
can be restored.

### Channels / roles / users
```
GET/PUT /api/1/connections/            (channels, groups, 4W direct)
PUT     /api/1/connections/:connectionId
GET     /api/1/connections/liveStatus
GET/PUT /api/1/roles/:roleId/:action
GET/PUT /api/1/ivpusers/:userId/:action
POST    /api/1/special/call
GET     /api/1/devices/:deviceId/alerts/current
GET     /api/1/events/:entityId
```
`connections` are filtered client-side by `type`: `partyline` (Channels),
`group` (Groups), `direct` (4W direct).

### socket.io live events
Client emits `EndpointInit`, `GpiInit`, `GpoInit` to prime caches, then
listens on:
```
live:devices     live:endpoints   live:connections  live:vpl
live:ports       live:interfaces  live:gpios        live:roles
live:alerts      live:calls       live:eventLog     live:ivpusers
live:externalDevices  live:linkgroupcapabilities  live:update
```
socket.io 1.6.0 server requires a v1.x/2.x-compatible client. Rather than
pin an old client, this module polls REST (`/api/1/devices/`,
`/api/1/connections/liveStatus`) which is version-stable and sufficient for
1–2 s feedback refresh.

## Kill switch design implications

| Strategy | Cuts held PTT? | Reversible | Notes |
|---|---|---|---|
| RMK all | No (latched keys only) | N/A (momentary) | Native, instant, safest |
| GPO relay | Yes, if wired to a mute input | Yes | Needs physical wiring |
| Port output gain floor | Attenuates only | Yes (restores prior) | No wiring needed |

The module implements all three plus a combined "PANIC" action, so the kill
switch degrades gracefully depending on how the rig is wired.
