import { endpointChoices, firstEndpointId, gpoChoices } from './choices.js'
import { combineRgb } from '@companion-module/base'

const RED = combineRgb(200, 0, 0)
const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)
const AMBER = combineRgb(255, 160, 0)
const GREEN = combineRgb(0, 150, 60)

export function getFeedbacks(self) {
	return {
		killed: {
			type: 'boolean',
			name: 'Comms killed',
			description: 'True while the kill switch is engaged.',
			defaultStyle: { bgcolor: RED, color: WHITE },
			options: [],
			callback: () => self.state.killed === true,
		},

		kill_flash: {
			type: 'boolean',
			name: 'Kill in progress (flashing window)',
			description:
				'True while the repeat window after a kill is still active. Pair with the Killed feedback for a flashing panic button.',
			defaultStyle: { bgcolor: AMBER, color: BLACK },
			options: [],
			callback: () => self.state.killBurstActive === true,
		},

		connected: {
			type: 'boolean',
			name: 'Base station reachable',
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [],
			callback: () => self.state.connected === true,
		},

		gpo_state: {
			type: 'boolean',
			name: 'GPO relay state',
			defaultStyle: { bgcolor: RED, color: WHITE },
			options: [
				{
					type: 'dropdown',
					id: 'id',
					label: 'GPO',
					default: gpoChoices(self)[0]?.id ?? '1',
					choices: gpoChoices(self),
					allowCustom: true,
				},
			],
			callback: async (feedback) => {
				const id = Number(await self.parseVariablesInString(String(feedback.options.id ?? '1')))
				return self.state.gpo[id] === true
			},
		},

		endpoint_talking: {
			type: 'boolean',
			name: 'Endpoint has an active talk key',
			description: 'True when the selected endpoint currently has a talk key active.',
			defaultStyle: { bgcolor: RED, color: WHITE },
			options: [
				{
					type: 'dropdown',
					id: 'endpoint',
					label: 'Endpoint',
					default: firstEndpointId(self),
					choices: endpointChoices(self),
					allowCustom: true,
					tooltip: 'Pick a beltpack or station by name, or type an ID / $(variable).',
				},
			],
			callback: async (feedback) => {
				const id = await self.parseVariablesInString(String(feedback.options.endpoint ?? ''))
				const ep = self.state.endpoints.find((e) => String(e.id) === String(id))
				return ep?.talking === true
			},
		},

		endpoint_online: {
			type: 'boolean',
			name: 'Endpoint online / registered',
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [
				{
					type: 'dropdown',
					id: 'endpoint',
					label: 'Endpoint',
					default: firstEndpointId(self),
					choices: endpointChoices(self),
					allowCustom: true,
					tooltip: 'Pick a beltpack or station by name, or type an ID / $(variable).',
				},
			],
			callback: async (feedback) => {
				const id = await self.parseVariablesInString(String(feedback.options.endpoint ?? ''))
				const ep = self.state.endpoints.find((e) => String(e.id) === String(id))
				return ep?.online === true
			},
		},

		any_talking: {
			type: 'boolean',
			name: 'Any endpoint talking',
			description: 'True when at least one endpoint has an active talk key — a live-mic warning.',
			defaultStyle: { bgcolor: RED, color: WHITE },
			options: [],
			callback: () => self.state.endpoints.some((e) => e.talking === true),
		},
	}
}
