/**
 * Integration tests for the Clear-Com FreeSpeak II Companion module.
 * Runs the module's real logic against a mock CCM server.
 */
import { createMockCcm } from './mock-ccm.js'
import { CcmClient } from '../src/api.js'
import { normaliseDevice, normaliseEndpoints, normaliseGpio } from '../src/parse.js'
import { getActions } from '../src/actions.js'
import { getFeedbacks } from '../src/feedbacks.js'
import { getPresets } from '../src/presets.js'
import { getConfigFields } from '../src/config.js'
import { getVariableDefinitions, buildVariableValues } from '../src/variables.js'

let pass = 0
let fail = 0
const failures = []

function check(name, cond, detail = '') {
	if (cond) {
		pass++
		console.log(`  PASS  ${name}`)
	} else {
		fail++
		failures.push(`${name} ${detail}`)
		console.log(`  FAIL  ${name} ${detail}`)
	}
}

/** Minimal stand-in for InstanceBase so we can drive the real module logic. */
class FakeInstance {
	constructor(config) {
		this.config = config
		this.logs = []
		this.variables = {}
		this.status = null
		this.client = new CcmClient(this)
		this.pollTimer = null
		this.burstTimer = null
		this.burstEndTimer = null
		this.pollInFlight = false
		this.endpointSignature = ''
		this.state = {
			connected: false,
			killed: false,
			killBurstActive: false,
			killCount: 0,
			lastKillTime: '',
			lastError: '',
			deviceName: '',
			deviceVersion: '',
			endpoints: [],
			gpo: {},
			gpi: {},
			savedGains: [],
		}
	}
	log(level, msg) {
		this.logs.push(`${level}: ${msg}`)
	}
	updateStatus(s, m) {
		this.status = { s, m }
	}
	setVariableValues(v) {
		Object.assign(this.variables, v)
	}
	setVariableDefinitions() {}
	setActionDefinitions() {}
	setFeedbackDefinitions() {}
	setPresetDefinitions() {}
	checkFeedbacks() {}
	async parseVariablesInString(s) {
		return s
	}
}

// Graft the real instance methods onto the fake so we test actual logic.
async function loadRealMethods(fake) {
	const mainSrc = await import('../main.js').catch(() => null)
	return mainSrc
}

async function main() {
	const { server, calls, state } = createMockCcm()
	await new Promise((r) => server.listen(0, '127.0.0.1', r))
	const port = server.address().port
	console.log(`Mock CCM listening on 127.0.0.1:${port}\n`)

	const config = {
		host: '127.0.0.1',
		port,
		username: 'admin',
		password: 'admin',
		deviceId: 1,
		timeout: 4000,
		pollInterval: 0,
		killHoldMs: 0,
		killUseGpo: false,
		killGpoIds: '1',
		killGpoState: 'true',
		verbose: false,
	}

	// ---------------------------------------------------------------
	console.log('1. Definitions are well formed')
	// ---------------------------------------------------------------
	const fake = new FakeInstance(config)
	fake.state.endpoints = [{ id: 11, label: 'BP1' }]

	const actions = getActions(fake)
	const feedbacks = getFeedbacks(fake)
	const presets = getPresets()
	const cfgFields = getConfigFields()
	const varDefs = getVariableDefinitions(fake)

	check('has comms_kill action', !!actions.comms_kill)
	check('has rmk action', !!actions.rmk)
	check('has rmk_repeat action', !!actions.rmk_repeat)
	check('has set_gpo action', !!actions.set_gpo)
	check('every action has a name + callback', Object.values(actions).every((a) => a.name && typeof a.callback === 'function'))
	check('every action option has an id', Object.values(actions).every((a) => (a.options ?? []).every((o) => !!o.id && !!o.type)))
	check('every feedback is boolean type w/ callback', Object.values(feedbacks).every((f) => f.type === 'boolean' && typeof f.callback === 'function'))
	check('config fields all have id+type', cfgFields.every((f) => !!f.id && !!f.type))
	check('variable defs all have variableId+name', varDefs.every((v) => !!v.variableId && !!v.name))

	// Presets must only reference actions/feedbacks that exist
	const actionIds = new Set(Object.keys(actions))
	const feedbackIds = new Set(Object.keys(feedbacks))
	let badRef = []
	for (const [pid, p] of Object.entries(presets)) {
		for (const step of p.steps ?? []) {
			for (const a of [...(step.down ?? []), ...(step.up ?? [])]) {
				if (!actionIds.has(a.actionId)) badRef.push(`${pid} -> action ${a.actionId}`)
			}
		}
		for (const f of p.feedbacks ?? []) {
			if (!feedbackIds.has(f.feedbackId)) badRef.push(`${pid} -> feedback ${f.feedbackId}`)
		}
	}
	check('presets only reference real actions/feedbacks', badRef.length === 0, badRef.join('; '))
	check('presets all have type button + category', Object.values(presets).every((p) => p.type === 'button' && !!p.category && !!p.name))

	// Variable references inside presets must resolve to declared variables
	const declared = new Set(varDefs.map((v) => v.variableId))
	const varRefs = []
	for (const [pid, p] of Object.entries(presets)) {
		const text = p.style?.text ?? ''
		for (const m of text.matchAll(/\$\(clearcom-freespeak2:([a-zA-Z0-9_]+)\)/g)) {
			if (!declared.has(m[1])) varRefs.push(`${pid} -> ${m[1]}`)
		}
	}
	check('preset variable references are declared', varRefs.length === 0, varRefs.join('; '))

	// ---------------------------------------------------------------
	console.log('\n2. API client + parsers against mock base station')
	// ---------------------------------------------------------------
	const client = fake.client

	const devRes = await client.getDevices()
	check('GET devices ok', devRes.ok)
	const dev = normaliseDevice(devRes.data, 1)
	check('device name parsed', dev.name === 'FSII Base Stage', `got "${dev.name}"`)
	check('device version parsed', dev.version === '1.6.15', `got "${dev.version}"`)

	const epRes = await client.getEndpoints(1)
	check('GET endpoints ok', epRes.ok)
	let eps = normaliseEndpoints(epRes.data)
	check('3 endpoints parsed', eps.length === 3, `got ${eps.length}`)
	check('endpoint labels parsed', eps[0].label === 'BP1 Stage Left')
	check('online detected', eps[0].online === true && eps[2].online === false)
	check('talking detected before kill', eps[0].talking === true && eps[1].talking === true)
	check('battery parsed', eps[0].battery === 82)
	check('rf parsed', eps[0].rf === 95)

	const gpioRes = await client.getGpio(0)
	const gpio = normaliseGpio(gpioRes.data)
	check('gpio parsed (4 gpo, 2 gpi)', Object.keys(gpio.gpo).length === 4 && Object.keys(gpio.gpi).length === 2)

	// ---------------------------------------------------------------
	console.log('\n3. THE KILL SWITCH - system wide RMK')
	// ---------------------------------------------------------------
	calls.length = 0
	const rmkRes = await client.rmk(1, null)
	check('RMK all returns ok', rmkRes.ok)
	check(
		'RMK all hits the collection route (no endpoint id)',
		calls.some((c) => c.method === 'POST' && c.url === '/api/1/devices/1/endpoints/rmk'),
		JSON.stringify(calls.map((c) => c.url)),
	)

	eps = normaliseEndpoints((await client.getEndpoints(1)).data)
	check('all talk keys released after RMK', eps.every((e) => e.talking === false))

	// Single endpoint RMK
	state.talking[11] = true
	calls.length = 0
	await client.rmk(1, 11)
	check(
		'RMK single hits the endpoint route',
		calls.some((c) => c.url === '/api/1/devices/1/endpoints/11/rmk'),
	)
	eps = normaliseEndpoints((await client.getEndpoints(1)).data)
	check('single endpoint silenced', eps.find((e) => e.id === 11).talking === false)

	// ---------------------------------------------------------------
	console.log('\n4. GPO hard cut')
	// ---------------------------------------------------------------
	await client.setGpo(1, 1, true)
	check('GPO 1 closed', state.gpo[1] === true)
	await client.setGpo(1, 1, null)
	check('GPO 1 override released', state.gpo[1] === false)

	// ---------------------------------------------------------------
	console.log('\n5. Port gain duck + restore')
	// ---------------------------------------------------------------
	const before = { ...state.ports['1/1'] }
	await client.updatePort(1, 1, 1, { settings: { outputGain: -12 } })
	check('port ducked to -12', state.ports['1/1'].outputGain === -12)
	await client.updatePort(1, 1, 1, { settings: { outputGain: before.outputGain } })
	check('port restored', state.ports['1/1'].outputGain === 6)

	// ---------------------------------------------------------------
	console.log('\n6. Auth failure handling')
	// ---------------------------------------------------------------
	const badFake = new FakeInstance({ ...config, password: 'wrong' })
	const badRes = await badFake.client.getDevices()
	check('401 detected', badRes.status === 401 && !badRes.ok)
	check('401 has helpful error', /Authentication failed/i.test(badRes.error ?? ''))

	// ---------------------------------------------------------------
	console.log('\n7. Unreachable host handling')
	// ---------------------------------------------------------------
	const deadFake = new FakeInstance({ ...config, host: '127.0.0.1', port: 1, timeout: 800 })
	const deadRes = await deadFake.client.getDevices()
	check('unreachable returns status 0, not a throw', deadRes.status === 0 && !deadRes.ok)

	const noHost = new FakeInstance({ ...config, host: '' })
	const noHostRes = await noHost.client.getDevices()
	check('missing host handled gracefully', !noHostRes.ok && /No base station IP/.test(noHostRes.error))

	// ---------------------------------------------------------------
	console.log('\n8. Variables build correctly')
	// ---------------------------------------------------------------
	const vfake = new FakeInstance(config)
	vfake.state.connected = true
	vfake.state.deviceName = 'FSII Base Stage'
	vfake.state.deviceVersion = '1.6.15'
	vfake.state.endpoints = normaliseEndpoints((await client.getEndpoints(1)).data)
	vfake.state.endpoints[0].talking = true
	vfake.state.gpo = { 1: true }
	vfake.state.killed = true
	const vals = buildVariableValues(vfake)
	check('connected variable', vals.connected === 'true')
	check('killed variable', vals.killed === 'true')
	check('endpoints_total', vals.endpoints_total === 3)
	check('endpoints_online', vals.endpoints_online === 2, `got ${vals.endpoints_online}`)
	check('endpoints_talking', vals.endpoints_talking === 1)
	check('talking_labels', vals.talking_labels === 'BP1 Stage Left', `got "${vals.talking_labels}"`)
	check('gpo_1 variable', vals.gpo_1 === 'true')
	check('per-endpoint label var', vals.ep_11_label === 'BP1 Stage Left')

	// All declared variables must receive a value
	const vdefs = getVariableDefinitions(vfake).map((v) => v.variableId)
	const missing = vdefs.filter((v) => vals[v] === undefined)
	check('every declared variable gets a value', missing.length === 0, missing.join(','))

	// ---------------------------------------------------------------
	console.log('\n9. Feedback callbacks evaluate')
	// ---------------------------------------------------------------
	const ffake = new FakeInstance(config)
	ffake.state.endpoints = vfake.state.endpoints
	ffake.state.killed = true
	ffake.state.connected = true
	ffake.state.gpo = { 1: true }
	const fbs = getFeedbacks(ffake)
	check('killed feedback true', (await fbs.killed.callback({ options: {} })) === true)
	check('connected feedback true', (await fbs.connected.callback({ options: {} })) === true)
	check('gpo_state feedback true', (await fbs.gpo_state.callback({ options: { id: '1' } })) === true)
	check('any_talking feedback true', (await fbs.any_talking.callback({ options: {} })) === true)
	check(
		'endpoint_talking feedback true for BP1',
		(await fbs.endpoint_talking.callback({ options: { endpoint: '11' } })) === true,
	)
	check(
		'endpoint_talking false for unknown endpoint',
		(await fbs.endpoint_talking.callback({ options: { endpoint: '999' } })) === false,
	)

	// ---------------------------------------------------------------
	console.log('\n10. Parser resilience to odd shapes')
	// ---------------------------------------------------------------
	check('endpoints from {endpoints:[...]}', normaliseEndpoints({ endpoints: [{ id: 5, label: 'X' }] }).length === 1)
	check('endpoints from keyed object', normaliseEndpoints({ a: { id: 7, label: 'Y' } }).length === 1)
	check('endpoints from null', normaliseEndpoints(null).length === 0)
	check('endpoints from string', normaliseEndpoints('nonsense').length === 0)
	check('device from empty', normaliseDevice([], 1).name === '')
	check('gpio from null', Object.keys(normaliseGpio(null).gpo).length === 0)
	check(
		'endpoint missing id is dropped',
		normaliseEndpoints([{ label: 'no id' }, { id: 3, label: 'ok' }]).length === 1,
	)

	server.close()

	console.log(`\n${'='.repeat(50)}`)
	console.log(`${pass} passed, ${fail} failed`)
	if (fail) {
		console.log('\nFailures:')
		failures.forEach((f) => console.log('  - ' + f))
		process.exit(1)
	}
	console.log('All tests passed.')
}

main().catch((e) => {
	console.error('Test harness error:', e)
	process.exit(1)
})
