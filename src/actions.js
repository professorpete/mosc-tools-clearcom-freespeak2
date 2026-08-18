import {
	ENDPOINT_ALL,
	endpointChoices,
	firstEndpointId,
	gpoChoices,
	gpiChoices,
	interfaceChoices,
	portChoices,
	gainChoices,
} from './choices.js'

export { ENDPOINT_ALL }

export function getActions(self) {
	return {
		// -------------------------------------------------------------
		// THE KILL SWITCH
		// -------------------------------------------------------------
		comms_kill: {
			name: 'Comms KILL (kill switch)',
			description:
				'Engage the comms kill: system-wide Remote Mic Kill, plus optional GPO relay and port gain ducking. Latching by default so the button shows kill state.',
			options: [
				{
					type: 'dropdown',
					id: 'mode',
					label: 'Mode',
					default: 'toggle',
					choices: [
						{ id: 'toggle', label: 'Toggle kill / restore' },
						{ id: 'kill', label: 'Kill only' },
						{ id: 'restore', label: 'Restore only' },
					],
				},
				{
					type: 'checkbox',
					id: 'useGpo',
					label: 'Drive GPO relay (overrides config setting)',
					default: false,
				},
				{
					type: 'checkbox',
					id: 'duckPorts',
					label: 'Also duck 4-wire port output gain to minimum',
					default: false,
				},
				{
					type: 'checkbox',
					id: 'respectExceptions',
					label: 'Respect kill exceptions from config (leave exempt packs live)',
					default: true,
					tooltip:
						'Uncheck for a true panic button that kills every endpoint including the exempt ones. ' +
						'Exceptions are chosen in this connection\'s config.',
				},
			],
			callback: async (event) => {
				const mode = event.options.mode ?? 'toggle'
				let kill
				if (mode === 'toggle') kill = !self.state.killed
				else kill = mode === 'kill'

				await self.setKill(kill, {
					useGpo: event.options.useGpo || self.config.killUseGpo,
					duckPorts: !!event.options.duckPorts,
					// Undefined on buttons created before this option existed -> default true.
					respectExceptions: event.options.respectExceptions !== false,
				})
			},
		},

		// -------------------------------------------------------------
		// RMK
		// -------------------------------------------------------------
		rmk: {
			name: 'Remote Mic Kill (RMK)',
			description:
				'Release latched talk keys. Choose ALL for a system-wide kill (every beltpack and wired station), or target one endpoint.',
			options: [
				{
					type: 'dropdown',
					id: 'endpoint',
					label: 'Endpoint',
					default: ENDPOINT_ALL,
					choices: endpointChoices(self, { includeAll: true }),
					allowCustom: true,
					tooltip:
						'Pick a beltpack or station by name. Custom value may be a numeric endpoint ID or $(variable).',
				},
			],
			callback: async (event) => {
				const raw = await self.parseVariablesInString(String(event.options.endpoint ?? ENDPOINT_ALL))
				const endpointId = raw === ENDPOINT_ALL || raw === '' ? null : raw
				await self.doRmk(endpointId)
			},
		},

		rmk_repeat: {
			name: 'Remote Mic Kill - repeated burst',
			description:
				'Send RMK repeatedly for a short period. Useful as a panic button when operators may re-latch keys during the kill.',
			options: [
				{
					type: 'number',
					id: 'durationMs',
					label: 'Duration (ms)',
					default: 3000,
					min: 100,
					max: 60000,
				},
				{
					type: 'number',
					id: 'intervalMs',
					label: 'Interval (ms)',
					default: 500,
					min: 100,
					max: 10000,
				},
			],
			callback: async (event) => {
				await self.rmkBurst(Number(event.options.durationMs), Number(event.options.intervalMs))
			},
		},

		// -------------------------------------------------------------
		// GPO / GPI
		// -------------------------------------------------------------
		set_gpo: {
			name: 'Set GPO relay',
			options: [
				{
					type: 'dropdown',
					id: 'id',
					label: 'GPO',
					default: gpoChoices(self)[0]?.id ?? '1',
					choices: gpoChoices(self),
					allowCustom: true,
					tooltip: 'Pick a relay, or type an ID / $(variable) for one not listed.',
				},
				{
					type: 'dropdown',
					id: 'state',
					label: 'State',
					default: 'true',
					choices: [
						{ id: 'true', label: 'Close / energise' },
						{ id: 'false', label: 'Open / de-energise' },
						{ id: 'release', label: 'Release override (back to normal)' },
						{ id: 'toggle', label: 'Toggle' },
					],
				},
			],
			callback: async (event) => {
				const id = Number(await self.parseVariablesInString(String(event.options.id ?? '1')))
				let enabled
				if (event.options.state === 'release') enabled = null
				else if (event.options.state === 'toggle') enabled = !self.state.gpo[id]
				else enabled = event.options.state === 'true'
				await self.doSetGpo(id, enabled)
			},
		},

		set_gpi: {
			name: 'Set GPI (virtual trigger)',
			options: [
				{
					type: 'dropdown',
					id: 'id',
					label: 'GPI',
					default: gpiChoices(self)[0]?.id ?? '1',
					choices: gpiChoices(self),
					allowCustom: true,
					tooltip: 'Pick an input, or type an ID / $(variable) for one not listed.',
				},
				{
					type: 'dropdown',
					id: 'state',
					label: 'State',
					default: 'true',
					choices: [
						{ id: 'true', label: 'Active' },
						{ id: 'false', label: 'Inactive' },
						{ id: 'release', label: 'Release override (back to normal)' },
					],
				},
			],
			callback: async (event) => {
				const id = Number(await self.parseVariablesInString(String(event.options.id ?? '1')))
				const enabled = event.options.state === 'release' ? null : event.options.state === 'true'
				const res = await self.client.setGpi(self.deviceId, id, enabled)
				self.handleResult(res, `Set GPI ${id} to ${enabled}`)
			},
		},

		// -------------------------------------------------------------
		// Call signal
		// -------------------------------------------------------------
		call_signal: {
			name: 'Call signal',
			options: [
				{
					type: 'dropdown',
					id: 'endpoint',
					label: 'Endpoint',
					default: ENDPOINT_ALL,
					choices: endpointChoices(self, { includeAll: true }),
					allowCustom: true,
				},
				{
					type: 'dropdown',
					id: 'active',
					label: 'Action',
					default: 'true',
					choices: [
						{ id: 'true', label: 'Call on' },
						{ id: 'false', label: 'Call off' },
					],
				},
				{
					type: 'textinput',
					id: 'text',
					label: 'Text message (optional)',
					default: '',
					useVariables: true,
				},
			],
			callback: async (event) => {
				const raw = await self.parseVariablesInString(String(event.options.endpoint ?? ENDPOINT_ALL))
				const endpointId = raw === ENDPOINT_ALL || raw === '' ? null : raw
				const text = await self.parseVariablesInString(String(event.options.text ?? ''))
				const res = await self.client.callSignal(
					self.deviceId,
					endpointId,
					event.options.active === 'true',
					text,
				)
				self.handleResult(res, `Call signal ${event.options.active} to ${endpointId ?? 'ALL'}`)
			},
		},

		// -------------------------------------------------------------
		// Port gain (duck / restore)
		// -------------------------------------------------------------
		port_gain: {
			name: 'Set port gain',
			description:
				'Set input or output gain on a port. Useful to duck or floor an interfaced 4-wire feed. Valid steps depend on interface type (2-wire: 3..-3 dB, 4-wire: 12..-12 dB).',
			options: [
				{
					type: 'dropdown',
					id: 'port',
					label: 'Interface : Port',
					default: portChoices(self)[0]?.id ?? '1:1',
					choices: portChoices(self),
					allowCustom: true,
					tooltip:
						'Pick a port from the base station, or type "interface:port" (e.g. 2:3). ' +
						'Supports $(variables).',
				},
				{
					type: 'dropdown',
					id: 'which',
					label: 'Gain',
					default: 'outputGain',
					choices: [
						{ id: 'outputGain', label: 'Output gain' },
						{ id: 'inputGain', label: 'Input gain' },
					],
				},
				{
					type: 'dropdown',
					id: 'value',
					label: 'Value (dB)',
					default: '-12',
					choices: gainChoices(),
					allowCustom: true,
					tooltip:
						'Valid steps depend on interface type: 2-wire is +3..-3, everything else +12..-12 in 3 dB steps.',
				},
			],
			callback: async (event) => {
				// Accepts the combined "interface:port" picker, and still honours
				// the older separate interfaceId/portId options on existing buttons.
				let interfaceId
				let portId
				if (event.options.port !== undefined && event.options.port !== '') {
					const combined = await self.parseVariablesInString(String(event.options.port))
					const [i, p] = String(combined).split(':')
					interfaceId = (i ?? '').trim()
					portId = (p ?? '').trim()
				} else {
					interfaceId = await self.parseVariablesInString(String(event.options.interfaceId ?? '1'))
					portId = await self.parseVariablesInString(String(event.options.portId ?? '1'))
				}
				if (!interfaceId || !portId) {
					self.log('warn', `Set port gain: could not read a valid interface:port from "${event.options.port ?? ''}"`)
					return
				}
				const value = Number(await self.parseVariablesInString(String(event.options.value)))
				const res = await self.client.updatePort(self.deviceId, interfaceId, portId, {
					settings: { [event.options.which]: value },
				})
				self.handleResult(res, `Port ${interfaceId}/${portId} ${event.options.which} = ${value} dB`)
			},
		},

		// -------------------------------------------------------------
		// Housekeeping
		// -------------------------------------------------------------
		reboot_endpoint: {
			name: 'Reboot endpoint',
			options: [
				{
					type: 'dropdown',
					id: 'endpoint',
					label: 'Endpoint',
					default: firstEndpointId(self),
					choices: endpointChoices(self),
					allowCustom: true,
					tooltip: 'Pick the beltpack or station to reboot. No "all" option here, on purpose.',
				},
			],
			callback: async (event) => {
				const endpointId = await self.parseVariablesInString(String(event.options.endpoint ?? ''))
				if (!endpointId) {
					self.log('warn', 'Reboot endpoint: no endpoint selected')
					return
				}
				const res = await self.client.rebootEndpoint(self.deviceId, endpointId)
				self.handleResult(res, `Reboot endpoint ${endpointId}`)
			},
		},

		refresh: {
			name: 'Refresh status from base station',
			options: [],
			callback: async () => {
				await self.poll(true)
			},
		},
	}
}
