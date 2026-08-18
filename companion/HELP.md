# Mosc-tools — Clear-Com FreeSpeak II Base Station

Controls a Clear-Com **FSII-BASE-II** base station over IP through its built-in
CCM web interface (REST API). The headline feature is a **comms kill switch**
that cuts all comms audio from a single button.

> This module talks to the same HTTP API the CCM browser UI uses. It was
> built against base station firmware **1.6.15** and needs no license or
> add-on — if you can open the CCM in a browser, this module can control it.

## Connecting to the base station

1. Find the base station IP: on the front panel go to
   **Menu → Networking → Preferences → IP address**, or check the DHCP lease.
2. Verify you can open `http://<base-ip>/` in a browser — that is the CCM.
3. In the module config, enter:
   - **Base station IP** — the address from step 1
   - **Port** — `80` unless you changed it
   - **Username / Password** — CCM credentials. Factory default is
     `admin` / `admin`.
4. The connection status turns **OK** once the module authenticates and reads
   the device list.

The module polls the base station for live status (endpoints online, talk
keys, GPIO states). Set **Poll interval** to `0` to disable polling if you
only want to fire actions.

## The kill switch

FreeSpeak II has no single "mute everything" endpoint, so the module layers
up to three mechanisms. **RMK** is always used; the other two are optional
per button or via the module config.

| Layer | What it does | Cuts a held (non-latched) PTT? |
| --- | --- | --- |
| **RMK (always)** | Remotely unlatches every talk key on every beltpack and wired station, wireless and wired. Repeats for the configured hold time so re-latches are stomped. | No — a physically held key re-opens audio |
| **GPO relay (optional)** | Drives base-station GPO relay(s). Wire a relay into your program/interrupt audio path (or an amp mute) for a true hard cut. | Yes, if wired into the audio path |
| **Port gain floor (optional)** | Drops output gain to minimum on all 4-wire/SIP/IVC ports, remembering previous values. Released kill restores them. | Attenuates only |

**RMK alone is the right default for "everyone off talk, now".** If you need
a guaranteed hard cut even against a held PTT key, wire a GPO relay into the
audio path and enable **Use GPO hard-cut** in the config, then set which GPO
IDs to drive.

### Kill behaviour notes

- Kill is **stateful**: the module tracks killed/live, and the `killed`
  feedback + `$(clearcom-freespeak2:killed)` variable drive button colour.
- Releasing the kill restores ducked port gains and releases GPO overrides
  (`enabled: null` hands the GPO back to normal base-station logic).
- **Fail-safe:** if the base station does not accept the kill (offline, auth
  error), the module logs an error and the button does **not** turn red —
  a kill that did nothing will never be shown as engaged.

## Actions

| Action | Description |
| --- | --- |
| **Comms kill switch** | Kill / restore / toggle. Options for GPO hard-cut and port-gain duck. |
| **RMK — remote master kill (talk keys)** | One-shot RMK to all endpoints or one endpoint ID. |
| **RMK repeat burst** | RMK every N ms for a duration (stomps re-latches). |
| **Set GPO / Set GPI** | Drive or release a GPIO override (`active` / `inactive` / `release to normal`). |
| **Call signal to endpoint** | Sends a call flash to a beltpack/station. |
| **Set port gain** | Set input/output gain on an interface port. |
| **Reboot endpoint** | Reboots a beltpack/station. |
| **Refresh state now** | Immediate poll. |

## Feedbacks

| Feedback | Description |
| --- | --- |
| **Comms killed** | Button style while kill is engaged. |
| **Kill burst in progress** | Flashing style while the RMK burst is running. |
| **Connected to base station** | Connection health. |
| **GPO active** | A given GPO is currently active. |
| **Endpoint talking / online** | Per-endpoint live state. |
| **Any talk key live** | Any endpoint currently has an open talk key. |

## Variables

Includes `killed`, `kill_count`, `last_kill_time`, `device_name`,
`endpoints_total`, `endpoints_online`, `endpoints_talking`, `gpo_1..4`,
`gpi_1..2`, plus per-endpoint name/online/talking/battery variables.

## Presets

Ready-made buttons under **Presets → Clear-Com FreeSpeak II**:

- **KILL COMMS (toggle)** — red latching kill with live/killed states
- **PANIC KILL (hard cut)** — kill + GPO hard-cut in one press
- **Momentary kill** — kill while held, restore on release
- **RMK all talk keys** — one-shot unlatch without entering the killed state
- **Connection / live-mic / endpoint status** displays
- **GPO 1–4 toggles** and **Call all endpoints**

## Troubleshooting

- **`Authentication failed`** — CCM username/password wrong. Defaults are
  `admin`/`admin`; the CCM forces a change on first browser login, so use
  whatever you set there.
- **`Connection refused / timeout`** — wrong IP, or the CCM is disabled.
  Confirm `http://<base-ip>/` loads in a browser from the same machine
  running Companion.
- **Kill engages but someone is still talking** — they are physically holding
  a non-latching PTT key. RMK cannot silence a held key; use the GPO
  hard-cut wired into the audio path for that.
- **GPO numbers** — FSII Base II (firmware 1.5.1+) exposes 2 GPIs and 4 GPOs.
  Check **Status → GPIO** in the CCM to confirm IDs.

## Compatibility

- Clear-Com FreeSpeak II Base II (FSII-BASE-II), firmware 1.5.x / 1.6.x
  (developed against 1.6.15)
- Not for FreeSpeak Edge on Arcadia/E-IPA — that uses a different API
- Uses the CCM REST API over HTTP Basic auth; HTTPS optional if enabled

---

Part of **Mosc-tools** — show-floor utilities by Peter Moscone.
Questions or ideas: [mosc-tools@moscone.ca](mailto:mosc-tools@moscone.ca) ·
[Project on GitHub](https://github.com/professorpete/mosc-tools-clearcom-freespeak2) ·
MIT licensed.
