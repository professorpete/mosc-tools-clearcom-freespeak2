import { Regex } from '@companion-module/base'

export function getConfigFields() {
	return [
		{
			type: 'static-text',
			id: 'info',
			width: 12,
			label: 'Clear-Com FreeSpeak II Base Station',
			value:
				'Controls an FSII-BASE-II over IP using the Core Configuration Manager (CCM) API. ' +
				'Enter the base station IP address exactly as you would to open the CCM in a browser. ' +
				'Find it on the base station front panel under Menu / Networking / Preferences / IP address.',
		},
		{
			type: 'textinput',
			id: 'host',
			label: 'Base Station IP address',
			width: 6,
			regex: Regex.HOSTNAME,
			default: '',
			required: true,
		},
		{
			type: 'number',
			id: 'port',
			label: 'Port',
			width: 3,
			default: 80,
			min: 1,
			max: 65535,
		},
		{
			type: 'checkbox',
			id: 'https',
			label: 'Use HTTPS',
			width: 3,
			default: false,
		},
		{
			type: 'textinput',
			id: 'username',
			label: 'CCM username',
			width: 6,
			default: 'admin',
		},
		{
			type: 'textinput',
			id: 'password',
			label: 'CCM password',
			width: 6,
			default: 'admin',
		},
		{
			type: 'static-text',
			id: 'infoDevice',
			width: 12,
			label: 'Device / polling',
			value:
				'Device ID is 1 for a standalone base station. Leave it alone unless you have been told otherwise.',
		},
		{
			type: 'number',
			id: 'deviceId',
			label: 'Device ID',
			width: 3,
			default: 1,
			min: 0,
			max: 64,
		},
		{
			type: 'number',
			id: 'pollInterval',
			label: 'Status poll (ms, 0 = off)',
			width: 3,
			default: 2000,
			min: 0,
			max: 60000,
		},
		{
			type: 'number',
			id: 'timeout',
			label: 'Request timeout (ms)',
			width: 3,
			default: 5000,
			min: 500,
			max: 30000,
		},
		{
			type: 'number',
			id: 'killHoldMs',
			label: 'Kill repeat window (ms)',
			width: 3,
			default: 3000,
			min: 0,
			max: 30000,
			tooltip:
				'After a kill, RMK is re-sent periodically for this long to catch keys that are re-latched during the kill. Set 0 for a single shot.',
		},
		{
			type: 'static-text',
			id: 'infoKill',
			width: 12,
			label: 'Kill switch behaviour',
			value:
				'<strong>Remote Mic Kill (RMK)</strong> releases every latched talk key instantly and is the safest kill. ' +
				'It does not silence someone physically holding a non-latching push-to-talk key — that is a limit of the ' +
				'FreeSpeak II protocol, not this module. For a guaranteed hard cut, wire a GPO relay into the mute/kill ' +
				'input of your matrix or console and enable the GPO option below, or use gain ducking on 4-wire ports.',
		},
		{
			type: 'checkbox',
			id: 'killUseGpo',
			label: 'Kill also drives a GPO relay',
			width: 4,
			default: false,
		},
		{
			type: 'textinput',
			id: 'killGpoIds',
			label: 'GPO relay IDs (comma separated, 1-4)',
			width: 4,
			default: '1',
			isVisible: (cfg) => !!cfg.killUseGpo,
		},
		{
			type: 'dropdown',
			id: 'killGpoState',
			label: 'GPO state when killed',
			width: 4,
			default: 'true',
			choices: [
				{ id: 'true', label: 'Close / energise relay' },
				{ id: 'false', label: 'Open / de-energise relay' },
			],
			isVisible: (cfg) => !!cfg.killUseGpo,
		},
		{
			type: 'checkbox',
			id: 'verbose',
			label: 'Verbose logging',
			width: 12,
			default: false,
		},
	]
}
