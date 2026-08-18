const ENDPOINT_ALL = '__all__'

export function getActions(self) {
	const endpointChoices = () => [
		{ id: ENDPOINT_ALL, label: 'ALL endpoints (system wide)' },
		...self.state.endpoints.map((e) => ({ id: String(e.id), label: e.label ?? `Endpoint ${e.id}` })),
	]

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
			],
			callback: async (event) => {
				const mode = event.options.mode ?? 'toggle'
				let kill
				if (mode === 'toggle') kill = !self.state.killed
				else kill = mode === 'kill'

				await self.setKill(kill, {
					useGpo: event.options.useGpo || self.config.killUseGpo,
					duckPorts: !!event.options.duckPorts,
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
					choices: endpointChoices(),
					allowCustom: true,
					tooltip: 'Custom value may be a numeric endpoint ID.',
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
					type: 'textinput',
					id: 'id',
					label: 'GPO ID (1-4)',
					default: '1',
					useVariables: true,
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
					type: 'textinput',
					id: 'id',
					label: 'GPI ID (1-2)',
					default: '1',
					useVariables: true,
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
					choices: endpointChoices(),
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
				{ type: 'textinput', id: 'interfaceId', label: 'Interface ID', default: '1', useVariables: true },
				{ type: 'textinput', id: 'portId', label: 'Port ID', default: '1', useVariables: true },
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
				{ type: 'textinput', id: 'value', label: 'Value (dB)', default: '-12', useVariables: true },
			],
			callback: async (event) => {
				const interfaceId = await self.parseVariablesInString(String(event.options.interfaceId))
				const portId = await self.parseVariablesInString(String(event.options.portId))
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
					default: '',
					choices: self.state.endpoints.map((e) => ({
						id: String(e.id),
						label: e.label ?? `Endpoint ${e.id}`,
					})),
					allowCustom: true,
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
