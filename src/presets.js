import { combineRgb } from '@companion-module/base'

const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)
const DARKRED = combineRgb(60, 0, 0)
const RED = combineRgb(200, 0, 0)
const AMBER = combineRgb(255, 160, 0)
const GREY = combineRgb(40, 40, 40)
const GREEN = combineRgb(0, 150, 60)

export function getPresets() {
	const presets = {}

	// ---- The headline kill switch -------------------------------------
	presets['kill_toggle'] = {
		type: 'button',
		category: 'Kill switch',
		name: 'COMMS KILL - latching toggle',
		style: {
			text: 'COMMS\\nKILL',
			size: '18',
			color: WHITE,
			bgcolor: DARKRED,
		},
		steps: [
			{
				down: [{ actionId: 'comms_kill', options: { mode: 'toggle', useGpo: false, duckPorts: false } }],
				up: [],
			},
		],
		feedbacks: [
			{
				feedbackId: 'killed',
				options: {},
				style: { bgcolor: RED, color: WHITE, text: 'COMMS\\nKILLED' },
			},
		],
	}

	presets['kill_panic'] = {
		type: 'button',
		category: 'Kill switch',
		name: 'PANIC - repeated RMK burst',
		style: {
			text: 'PANIC\\nRMK',
			size: '18',
			color: BLACK,
			bgcolor: AMBER,
		},
		steps: [
			{
				down: [{ actionId: 'rmk_repeat', options: { durationMs: 3000, intervalMs: 400 } }],
				up: [],
			},
		],
		feedbacks: [
			{
				feedbackId: 'kill_flash',
				options: {},
				style: { bgcolor: RED, color: WHITE },
			},
		],
	}

	presets['kill_momentary'] = {
		type: 'button',
		category: 'Kill switch',
		name: 'KILL while held (restore on release)',
		style: {
			text: 'HOLD\\nTO KILL',
			size: '14',
			color: WHITE,
			bgcolor: DARKRED,
		},
		steps: [
			{
				down: [{ actionId: 'comms_kill', options: { mode: 'kill', useGpo: false, duckPorts: false } }],
				up: [{ actionId: 'comms_kill', options: { mode: 'restore', useGpo: false, duckPorts: false } }],
			},
		],
		feedbacks: [{ feedbackId: 'killed', options: {}, style: { bgcolor: RED, color: WHITE } }],
	}

	presets['rmk_all'] = {
		type: 'button',
		category: 'Kill switch',
		name: 'RMK ALL (single shot)',
		style: { text: 'RMK\\nALL', size: '18', color: WHITE, bgcolor: DARKRED },
		steps: [{ down: [{ actionId: 'rmk', options: { endpoint: '__all__' } }], up: [] }],
		feedbacks: [],
	}

	presets['kill_with_gpo'] = {
		type: 'button',
		category: 'Kill switch',
		name: 'COMMS KILL + GPO hard cut',
		style: { text: 'HARD\\nKILL', size: '18', color: WHITE, bgcolor: DARKRED },
		steps: [
			{
				down: [{ actionId: 'comms_kill', options: { mode: 'toggle', useGpo: true, duckPorts: false } }],
				up: [],
			},
		],
		feedbacks: [
			{ feedbackId: 'killed', options: {}, style: { bgcolor: RED, color: WHITE, text: 'HARD\\nKILLED' } },
		],
	}

	// ---- Status -------------------------------------------------------
	presets['status_connection'] = {
		type: 'button',
		category: 'Status',
		name: 'Base station connection',
		style: { text: 'FSII\\n$(clearcom-freespeak2:device_name)', size: '14', color: WHITE, bgcolor: GREY },
		steps: [{ down: [{ actionId: 'refresh', options: {} }], up: [] }],
		feedbacks: [{ feedbackId: 'connected', options: {}, style: { bgcolor: GREEN, color: WHITE } }],
	}

	presets['status_live_mic'] = {
		type: 'button',
		category: 'Status',
		name: 'Live mic warning (any talking)',
		style: {
			text: 'MICS\\n$(clearcom-freespeak2:endpoints_talking)',
			size: '18',
			color: WHITE,
			bgcolor: GREY,
		},
		steps: [{ down: [{ actionId: 'rmk', options: { endpoint: '__all__' } }], up: [] }],
		feedbacks: [{ feedbackId: 'any_talking', options: {}, style: { bgcolor: RED, color: WHITE } }],
	}

	presets['status_endpoints'] = {
		type: 'button',
		category: 'Status',
		name: 'Endpoints online / total',
		style: {
			text: 'BP\\n$(clearcom-freespeak2:endpoints_online)/$(clearcom-freespeak2:endpoints_total)',
			size: '14',
			color: WHITE,
			bgcolor: GREY,
		},
		steps: [{ down: [{ actionId: 'refresh', options: {} }], up: [] }],
		feedbacks: [],
	}

	// ---- GPO ----------------------------------------------------------
	for (let i = 1; i <= 4; i++) {
		presets[`gpo_${i}`] = {
			type: 'button',
			category: 'GPO relays',
			name: `GPO ${i} toggle`,
			style: { text: `GPO ${i}\\n$(clearcom-freespeak2:gpo_${i})`, size: '14', color: WHITE, bgcolor: GREY },
			steps: [{ down: [{ actionId: 'set_gpo', options: { id: String(i), state: 'toggle' } }], up: [] }],
			feedbacks: [{ feedbackId: 'gpo_state', options: { id: String(i) }, style: { bgcolor: RED, color: WHITE } }],
		}
	}

	// ---- Call ---------------------------------------------------------
	presets['call_all'] = {
		type: 'button',
		category: 'Call',
		name: 'Call signal ALL (momentary)',
		style: { text: 'CALL\\nALL', size: '18', color: BLACK, bgcolor: AMBER },
		steps: [
			{
				down: [{ actionId: 'call_signal', options: { endpoint: '__all__', active: 'true', text: '' } }],
				up: [{ actionId: 'call_signal', options: { endpoint: '__all__', active: 'false', text: '' } }],
			},
		],
		feedbacks: [],
	}

	return presets
}
