<p align="center">
  <img src="docs/mosc-tools-logo.png" alt="Mosc-tools" width="130">
</p>

<h1 align="center">Mosc-tools — Clear-Com FreeSpeak II for Companion</h1>

<p align="center">
  A <a href="https://bitfocus.io/companion">Bitfocus Companion</a> module for the
  Clear-Com <strong>FreeSpeak II</strong> base station.<br>
  Built around one thing: a comms <strong>kill switch</strong> that actually kills comms.
</p>

<p align="center">
  <a href="https://github.com/professorpete/mosc-tools-clearcom-freespeak2/raw/main/dist/clearcom-freespeak2-1.0.0.tgz">
    <img src="https://img.shields.io/badge/⬇%20Download-module%20package-2ea44f?style=for-the-badge&labelColor=1a1a1a" alt="Download module package">
  </a>
  &nbsp;
  <a href="#the-kill-switch">
    <img src="https://img.shields.io/badge/🔴%20Kill%20switch-how%20it%20works-dc2626?style=for-the-badge&labelColor=1a1a1a" alt="Kill switch">
  </a>
  &nbsp;
  <a href="https://buymeacoffee.com/mosctools">
    <img src="https://img.shields.io/badge/☕%20Enjoying%20this%20tool%3F-Buy%20me%20a%20coffee-FFDD00?style=for-the-badge&labelColor=1a1a1a" alt="Buy me a coffee">
  </a>
</p>

<p align="center">
  <em>No Clear-Com license. No HCI. No Eclipse frame. If the CCM opens in a browser, this works.</em>
</p>

## Why

There is no official Companion module for FreeSpeak II, and no published API for the
base station. Clear-Com's documented control path (HCI) is an Eclipse HX thing —
licensed, and irrelevant if all you own is an FSII base.

But the base station already has a full REST API: it's what its own CCM web interface
runs on. So this module drives that. The routes here were recovered by pulling apart
FSII-BASE-II firmware **v1.6.15** and reading the CCM frontend
(see [`docs/API.md`](docs/API.md) for the whole map).

And the reason to want it: **when a mic needs to be off, it needs to be off now** — not
after you've alt-tabbed to a browser, logged into the CCM and hunted for the right button.
One Streamdeck key.

## What you get

- **Comms kill switch** — a real, stateful kill with three layered mechanisms
  (see [below](#the-kill-switch)). Kill, restore, or toggle.
- **Fail-safe by design** — if the base station never accepted the kill, the button
  does **not** turn red. It logs an error instead. A dead red button is worse than no
  button, so this one refuses to lie to you.
- **RMK** to all endpoints or a single beltpack, plus a repeating burst mode that
  stomps re-latches.
- **GPO / GPI control** — set active, inactive, or release the override back to normal
  base-station logic.
- **Port gain** — input/output gain on any interface port, with correct step values per
  port type (2-wire, 4-wire, IVC, E1, SIP).
- **Call signals** and **endpoint reboot**.
- **Live status polling** — endpoints online, who's talking, battery levels, GPIO states,
  all exposed as variables and feedbacks.
- **11 presets** ready to drop on a page, including a latching KILL COMMS toggle, a
  panic hard-cut, and a momentary kill-while-held.

## Quick start

1. **Get the base station IP.** On the front panel: **Menu → Networking → Preferences →
   IP address**. Confirm `http://<base-ip>/` loads the CCM in a browser.
2. **Install the module.** Download
   [`clearcom-freespeak2-1.0.0.tgz`](https://github.com/professorpete/mosc-tools-clearcom-freespeak2/raw/main/dist/clearcom-freespeak2-1.0.0.tgz), then in Companion 3.4+:
   **Connections → Import module package**. (Or build from source and point your
   developer modules path at `pkg/`.)
3. **Add the connection** — *Clear-Com: FreeSpeak II Base Station*. Enter the IP and
   your CCM login. Factory default is `admin` / `admin`, but the CCM forces a change on
   first browser login, so use whatever you actually set.
4. **Drop a preset on a button.** Presets → *Clear-Com FreeSpeak II* → **KILL COMMS**.

Status goes green once the module authenticates and reads the device list.

## The kill switch

FreeSpeak II has no single "mute everything" endpoint, so the kill layers up to three
mechanisms. **RMK always runs**; the other two are opt-in per button or in the connection
config.

| Layer | What it does | Cuts a *held* PTT key? |
| --- | --- | --- |
| **RMK** *(always)* | Remotely unlatches every talk key on every beltpack and wired station. Repeats on an interval for the hold time, so a pack that re-latches mid-burst gets unlatched again. | ❌ — a physically held key re-opens audio |
| **GPO relay** *(optional)* | Drives base-station GPO relay(s). Wire one into your program/interrupt path or an amp mute. | ✅ — if it's wired into the audio path |
| **Port gain floor** *(optional)* | Drops output gain to minimum on all 4-wire/SIP/IVC ports, remembering the previous values and restoring them on release. | ⚠️ attenuates only |

**For "everyone off talk, right now", RMK alone is the correct default.** If you need a
guarantee that survives someone leaning on their PTT, wire a GPO relay into the audio
path and enable **Use GPO hard-cut**.

Releasing the kill restores ducked gains and hands GPO overrides back to normal base logic
(`enabled: null`), so you're not left with a latched relay after the show.

## Actions

| Action | Notes |
| --- | --- |
| **Comms kill switch** | Kill / restore / toggle, with GPO and port-duck options |
| **RMK — remote master kill (talk keys)** | All endpoints, or one by ID |
| **RMK repeat burst** | Every N ms for a set duration |
| **Set GPO** / **Set GPI** | Active, inactive, or release-to-normal |
| **Call signal to endpoint** | Call flash to a beltpack or station |
| **Set port gain** | Per interface + port, input or output |
| **Reboot endpoint** | Reboots a beltpack/station |
| **Refresh state now** | Immediate poll |

## Feedbacks & variables

Feedbacks: **comms killed**, **kill burst in progress**, **connected**, **GPO active**,
**endpoint talking**, **endpoint online**, **any talk key live**.

Variables include `killed`, `kill_count`, `last_kill_time`, `device_name`,
`endpoints_total`, `endpoints_online`, `endpoints_talking`, `gpo_1`–`gpo_4`,
`gpi_1`–`gpi_2`, plus per-endpoint name / online / talking / battery.

## Compatibility

| | |
| --- | --- |
| **Hardware** | Clear-Com FreeSpeak II Base II (FSII-BASE-II) |
| **Firmware** | 1.5.x / 1.6.x — developed against **1.6.15** |
| **Companion** | 3.x and newer (module API 1.14.1) |
| **Transport** | CCM REST API over HTTP Basic auth; HTTPS if you've enabled it |

**Not** for FreeSpeak Edge on Arcadia / E-IPA — different platform, different API.

> ⚠️ This module was built against the real API surface and is covered by 140 automated
> tests against a mock base station, but it has not yet been run on live hardware.
> **Test it off-show first.**

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `Authentication failed` | Wrong CCM credentials. Defaults are `admin`/`admin`, but the CCM forces a change on first login. |
| `Connection refused` / timeout | Wrong IP, or CCM unreachable from the Companion machine. Load `http://<base-ip>/` in a browser there to confirm. |
| Kill engages, someone's still talking | They're holding a non-latching PTT key. RMK can't silence a held key — that's what the GPO hard-cut is for. |
| Wrong GPO fires | FSII Base II (fw 1.5.1+) has 2 GPIs and 4 GPOs. Confirm IDs under **Status → GPIO** in the CCM. |

## Develop

```bash
npm install
node test/run-tests.js            # API client against a mock CCM
node test/run-instance-tests.js   # full instance behaviour
npx companion-module-build        # build pkg/ + .tgz
node test/run-bundle-test.js      # boots the built bundle over real Companion IPC
```

The mock CCM in `test/mock-ccm.js` mimics the base station's REST API — auth, RMK, GPIO
and port-gain behaviour — so the whole module can be exercised without hardware. The
bundle test forks the *packaged* module and speaks the `nodejs-ipc` protocol to it the
same way Companion does.

## Support

Questions or ideas: [mosc-tools@moscone.ca](mailto:mosc-tools@moscone.ca)

If this tool saved your show day, consider
[buying me a coffee](https://buymeacoffee.com/mosctools) ☕ — it keeps the Mosc-tools
side projects alive.

MIT licensed.
