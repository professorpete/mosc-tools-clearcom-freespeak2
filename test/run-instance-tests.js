/**
 * Drives the REAL FreeSpeak2Instance class (not a stand-in) against the
 * mock CCM server, so the kill switch state machine is genuinely tested.
 */
import { createMockCcm } from './mock-ccm.js'
import { FreeSpeak2Instance } from '../src/instance.js'
import { normaliseEndpoints } from '../src/parse.js'

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

/**
 * Build a real instance without going through Companion's IPC layer.
 * We bypass the InstanceBase constructor's socket wiring by creating the
 * object via Object.create and running our own field init.
 */
function makeInstance(config) {
	const inst = Object.create(FreeSpeak2Instance.prototype)

	// Replicate what the real constructor sets up.
	const { CcmClient } = mod
	inst.client = new CcmClient(inst)
	inst.pollTimer = null
	inst.burstTimer = null
	inst.burstEndTimer = null
	inst.pollInFlight = false
	inst.endpointSignature = ''
	inst.state = {
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

	// Stub the InstanceBase surface the module uses.
	inst.config = config
	inst.logs = []
	inst.variables = {}
	inst.statusHistory = []
	inst.log = (level, msg) => inst.logs.push(`${level}: ${msg}`)
	inst.updateStatus = (s, m) => inst.statusHistory.push({ s, m })
	inst.setVariableValues = (v) => Object.assign(inst.variables, v)
	inst.setVariableDefinitions = () => {}
	inst.setActionDefinitions = () => {}
	inst.setFeedbackDefinitions = () => {}
	inst.setPresetDefinitions = () => {}
	inst.checkFeedbacks = () => {}
	inst.parseVariablesInString = async (s) => s

	return inst
}

let mod
async function main() {
	mod = await import('../src/api.js')

	const { server, calls, state } = createMockCcm()
	await new Promise((r) => server.listen(0, '127.0.0.1', r))
	const port = server.address().port
	console.log(`Mock CCM on 127.0.0.1:${port}\n`)

	const baseConfig = {
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

	// -------------------------------------------------------------
	console.log('1. init() connects and populates state')
	// -------------------------------------------------------------
	const inst = makeInstance({ ...baseConfig })
	await inst.init(inst.config)

	check('connected', inst.state.connected === true)
	check('status went Ok', inst.statusHistory.some((h) => h.s === 'ok'), JSON.stringify(inst.statusHistory))
	check('device name populated', inst.state.deviceName === 'FSII Base Stage')
	check('endpoints populated', inst.state.endpoints.length === 3)
	check('variables populated', inst.variables.device_name === 'FSII Base Stage')
	check('deviceId getter', inst.deviceId === 1)

	// -------------------------------------------------------------
	console.log('\n2. Kill switch: toggle engages and restores')
	// -------------------------------------------------------------
	state.talking[11] = true
	state.talking[12] = true
	calls.length = 0

	const actions = (await import('../src/actions.js')).getActions(inst)
	await actions.comms_kill.callback({ options: { mode: 'toggle', useGpo: false, duckPorts: false } })

	check('killed state true after toggle', inst.state.killed === true)
	check('kill sent RMK all', calls.some((c) => c.url === '/api/1/devices/1/endpoints/rmk'))
	check('base station cleared talk keys', Object.values(state.talking).every((v) => v === false))
	check('kill_count incremented', inst.state.killCount >= 1)
	check('last_kill_time set', !!inst.state.lastKillTime)
	check('killed variable reflects state', inst.variables.killed === 'true')
	check('warn logged on kill', inst.logs.some((l) => /COMMS KILL engaged/.test(l)))

	// Toggle back
	await actions.comms_kill.callback({ options: { mode: 'toggle', useGpo: false, duckPorts: false } })
	check('killed state false after second toggle', inst.state.killed === false)
	check('killed variable restored', inst.variables.killed === 'false')
	check('release logged', inst.logs.some((l) => /COMMS KILL released/.test(l)))

	// -------------------------------------------------------------
	console.log('\n3. Kill switch: explicit kill / restore modes')
	// -------------------------------------------------------------
	await actions.comms_kill.callback({ options: { mode: 'kill' } })
	check('mode=kill engages', inst.state.killed === true)
	await actions.comms_kill.callback({ options: { mode: 'kill' } })
	check('mode=kill is idempotent', inst.state.killed === true)
	await actions.comms_kill.callback({ options: { mode: 'restore' } })
	check('mode=restore releases', inst.state.killed === false)
	await actions.comms_kill.callback({ options: { mode: 'restore' } })
	check('mode=restore is idempotent', inst.state.killed === false)

	// -------------------------------------------------------------
	console.log('\n4. Kill switch with GPO hard cut')
	// -------------------------------------------------------------
	const ginst = makeInstance({ ...baseConfig, killUseGpo: true, killGpoIds: '1,2', killGpoState: 'true' })
	await ginst.init(ginst.config)
	const gactions = (await import('../src/actions.js')).getActions(ginst)

	await gactions.comms_kill.callback({ options: { mode: 'kill', useGpo: true } })
	check('GPO 1 closed on kill', state.gpo[1] === true)
	check('GPO 2 closed on kill', state.gpo[2] === true)
	check('module tracks gpo state', ginst.state.gpo[1] === true)

	await gactions.comms_kill.callback({ options: { mode: 'restore', useGpo: true } })
	check('GPO 1 released on restore', state.gpo[1] === false)
	check('GPO 2 released on restore', state.gpo[2] === false)

	// Multi-id parsing
	check('parseIdList handles spaces', JSON.stringify(ginst.parseIdList(' 1 , 2 ,3 ')) === '[1,2,3]')
	check('parseIdList ignores junk', JSON.stringify(ginst.parseIdList('1,x,,4')) === '[1,4]')

	// -------------------------------------------------------------
	console.log('\n5. Kill switch with port gain duck + restore')
	// -------------------------------------------------------------
	state.ports['1/1'].outputGain = 6
	state.ports['1/2'].outputGain = 0
	const dinst = makeInstance({ ...baseConfig })
	await dinst.init(dinst.config)
	const dactions = (await import('../src/actions.js')).getActions(dinst)

	await dactions.comms_kill.callback({ options: { mode: 'kill', duckPorts: true } })
	check('port 1 ducked', state.ports['1/1'].outputGain === -12, `got ${state.ports['1/1'].outputGain}`)
	check('port 2 ducked', state.ports['1/2'].outputGain === -12)
	check('saved gains recorded', dinst.state.savedGains.length === 2)

	await dactions.comms_kill.callback({ options: { mode: 'restore', duckPorts: true } })
	check('port 1 gain restored to 6', state.ports['1/1'].outputGain === 6, `got ${state.ports['1/1'].outputGain}`)
	check('port 2 gain restored to 0', state.ports['1/2'].outputGain === 0)
	check('saved gains cleared', dinst.state.savedGains.length === 0)

	// -------------------------------------------------------------
	console.log('\n6. RMK burst repeats then stops')
	// -------------------------------------------------------------
	const binst = makeInstance({ ...baseConfig })
	await binst.init(binst.config)
	calls.length = 0

	await binst.rmkBurst(900, 200)
	check('burst active immediately', binst.state.killBurstActive === true)
	await new Promise((r) => setTimeout(r, 1400))
	check('burst cleared after duration', binst.state.killBurstActive === false)
	const rmkCalls = calls.filter((c) => c.url === '/api/1/devices/1/endpoints/rmk').length
	check('burst sent multiple RMKs', rmkCalls >= 3, `sent ${rmkCalls}`)

	// No timers left dangling
	check('burst timers cleared', binst.burstTimer === null && binst.burstEndTimer === null)

	// -------------------------------------------------------------
	console.log('\n7. Single-shot kill (killHoldMs = 0)')
	// -------------------------------------------------------------
	const sinst = makeInstance({ ...baseConfig, killHoldMs: 0 })
	await sinst.init(sinst.config)
	calls.length = 0
	await sinst.setKill(true, {})
	const single = calls.filter((c) => c.url === '/api/1/devices/1/endpoints/rmk').length
	check('single shot sends exactly one RMK', single === 1, `sent ${single}`)
	check('no lingering burst', sinst.state.killBurstActive === false)
	await sinst.destroy()

	// -------------------------------------------------------------
	console.log('\n8. Auth failure surfaces correctly through init()')
	// -------------------------------------------------------------
	const ainst = makeInstance({ ...baseConfig, password: 'nope' })
	await ainst.init(ainst.config)
	check('not connected on bad auth', ainst.state.connected === false)
	check(
		'status is authentication_failure',
		ainst.statusHistory.some((h) => h.s === 'authentication_failure'),
		JSON.stringify(ainst.statusHistory),
	)
	check('last_error variable set', /Auth/i.test(ainst.variables.last_error ?? ''))

	// Kill attempt while unauthenticated must not throw
	let threw = false
	try {
		await ainst.setKill(true, {})
	} catch {
		threw = true
	}
	check('kill on unauthenticated instance does not throw', threw === false)
	check('error logged', ainst.logs.some((l) => /^error:/.test(l)))
	await ainst.destroy()

	// -------------------------------------------------------------
	console.log('\n9. Bad config / unreachable host')
	// -------------------------------------------------------------
	const cinst = makeInstance({ ...baseConfig, host: '' })
	await cinst.init(cinst.config)
	check('bad config status', cinst.statusHistory.some((h) => h.s === 'bad_config'))

	const uinst = makeInstance({ ...baseConfig, port: 1, timeout: 700 })
	await uinst.init(uinst.config)
	check('connection_failure status', uinst.statusHistory.some((h) => h.s === 'connection_failure'))
	check('not connected', uinst.state.connected === false)

	// FAIL-SAFE: if the base station is unreachable, the kill switch must
	// NOT report success. The operator must never trust a dead red button.
	const killResult = await uinst.setKill(true, { useGpo: false, duckPorts: false })
	check('kill against dead base returns false', killResult === false)
	check('killed state stays false when kill fails', uinst.state.killed === false)
	check('kill failure logged as error', uinst.logs.some((l) => /error.*KILL FAILED/i.test(l)))
	check('no orphaned burst timer after failed kill', uinst.burstTimer === null)
	await uinst.destroy()

	// -------------------------------------------------------------
	console.log('\n10. Polling starts/stops cleanly')
	// -------------------------------------------------------------
	const pinst = makeInstance({ ...baseConfig, pollInterval: 300 })
	await pinst.init(pinst.config)
	check('poll timer running', pinst.pollTimer !== null)
	await new Promise((r) => setTimeout(r, 800))
	await pinst.destroy()
	check('poll timer cleared on destroy', pinst.pollTimer === null)

	// configUpdated should restart cleanly
	const uinst2 = makeInstance({ ...baseConfig, pollInterval: 500 })
	await uinst2.init(uinst2.config)
	await uinst2.configUpdated({ ...baseConfig, pollInterval: 400 })
	check('poll timer alive after configUpdated', uinst2.pollTimer !== null)
	await uinst2.destroy()
	check('clean shutdown after configUpdated', uinst2.pollTimer === null && uinst2.burstTimer === null)

	// -------------------------------------------------------------
	console.log('\n11. Concurrent poll guard')
	// -------------------------------------------------------------
	const qinst = makeInstance({ ...baseConfig })
	await qinst.init(qinst.config)
	calls.length = 0
	await Promise.all([qinst.poll(), qinst.poll(), qinst.poll()])
	const deviceCalls = calls.filter((c) => c.url === '/api/1/devices/').length
	check('overlapping polls are coalesced', deviceCalls === 1, `saw ${deviceCalls} device calls`)
	await qinst.destroy()

	// -------------------------------------------------------------
	console.log('\n12. Endpoint-targeted actions')
	// -------------------------------------------------------------
	state.talking[11] = true
	state.talking[12] = true
	const einst = makeInstance({ ...baseConfig })
	await einst.init(einst.config)
	const eactions = (await import('../src/actions.js')).getActions(einst)

	await eactions.rmk.callback({ options: { endpoint: '11' } })
	let eps = normaliseEndpoints((await einst.client.getEndpoints(1)).data)
	check('targeted RMK silenced only BP1', eps.find((e) => e.id === 11).talking === false && eps.find((e) => e.id === 12).talking === true)

	await eactions.rmk.callback({ options: { endpoint: '__all__' } })
	eps = normaliseEndpoints((await einst.client.getEndpoints(1)).data)
	check('ALL RMK silenced everything', eps.every((e) => e.talking === false))

	// GPO toggle action
	await eactions.set_gpo.callback({ options: { id: '3', state: 'toggle' } })
	check('GPO toggle turned on', state.gpo[3] === true)
	await eactions.set_gpo.callback({ options: { id: '3', state: 'toggle' } })
	check('GPO toggle turned off', state.gpo[3] === false)
	await eactions.set_gpo.callback({ options: { id: '3', state: 'release' } })
	check('GPO release accepted', einst.state.gpo[3] === undefined)

	// Call signal + reboot + refresh should all succeed
	let ok = true
	try {
		await eactions.call_signal.callback({ options: { endpoint: '__all__', active: 'true', text: 'STANDBY' } })
		await eactions.call_signal.callback({ options: { endpoint: '11', active: 'false', text: '' } })
		await eactions.reboot_endpoint.callback({ options: { endpoint: '11' } })
		await eactions.refresh.callback({ options: {} })
	} catch (e) {
		ok = false
		console.log('    threw:', e.message)
	}
	check('call/reboot/refresh actions run without throwing', ok)

	// reboot with no endpoint should warn, not throw
	const before = einst.logs.length
	await eactions.reboot_endpoint.callback({ options: { endpoint: '' } })
	check('reboot with empty endpoint warns', einst.logs.slice(before).some((l) => /warn/.test(l)))

	// set_gpi
	await eactions.set_gpi.callback({ options: { id: '1', state: 'true' } })
	check('GPI set active', state.gpi[1] === true)

	// port_gain action
	await eactions.port_gain.callback({
		options: { interfaceId: '1', portId: '1', which: 'outputGain', value: '-9' },
	})
	check('port_gain action applied', state.ports['1/1'].outputGain === -9)

	// -----------------------------------------------------------------
	// Dropdown choice building
	// -----------------------------------------------------------------
	const {
		endpointChoices,
		portChoices,
		gpoChoices,
		gpiChoices,
		gainChoices,
		choicesSignature,
		firstEndpointId,
	} = await import('../src/choices.js')

	const epChoices = endpointChoices(einst)
	check('endpoint dropdown lists every endpoint', epChoices.length === einst.state.endpoints.length)
	check(
		'endpoint dropdown labels include id and name',
		epChoices.every((c) => /^\d+ · /.test(c.label)),
		JSON.stringify(epChoices[0]),
	)

	// Offline packs sort last and are marked, so you do not target a dead pack.
	const mixed = {
		state: {
			endpoints: [
				{ id: 5, label: 'Dead Pack', type: 'BP', online: false },
				{ id: 9, label: 'Stage Manager', type: 'HBP-2X', online: true },
			],
		},
	}
	const mixedChoices = endpointChoices(mixed)
	check('online endpoints sort before offline', mixedChoices[0].id === '9')
	check('offline endpoints are marked', /offline/.test(mixedChoices[1].label))
	check('endpoint type shown in label', /HBP-2X/.test(mixedChoices[0].label))
	check('firstEndpointId prefers an online endpoint', firstEndpointId(mixed) === '9')

	const emptyChoices = endpointChoices({ state: { endpoints: [] } })
	check('empty endpoint list yields a hint choice, never a crash', emptyChoices.length === 1)

	const allChoices = endpointChoices(einst, { includeAll: true })
	check('includeAll adds the system-wide option first', allChoices[0].id === '__all__')

	// Interfaces were polled, so the port picker should be populated.
	check('interfaces were read into state', einst.state.interfaces.length > 0)
	const pChoices = portChoices(einst)
	check('port dropdown flattens to interface:port ids', pChoices.some((c) => c.id === '1:2'))
	check('port dropdown label carries interface type', pChoices.every((c) => /\[4W\]/.test(c.label)))
	check('port dropdown falls back when nothing known', portChoices({ state: {} })[0].id === '1:1')

	check('GPO dropdown offers the discovered relays', gpoChoices(einst).length >= 1)
	check('GPI dropdown falls back to 2 inputs', gpiChoices({ state: {} }).length === 2)
	check('2-wire gain steps are +3..-3', gainChoices('2W')[0].id === '3')
	check('4-wire gain steps are +12..-12', gainChoices('4W')[0].id === '12')

	// -----------------------------------------------------------------
	// port_gain via the combined dropdown, and legacy options
	// -----------------------------------------------------------------
	await eactions.port_gain.callback({ options: { port: '1:2', which: 'outputGain', value: '-6' } })
	check('port_gain accepts the interface:port dropdown value', state.ports['1/2'].outputGain === -6)

	await eactions.port_gain.callback({
		options: { interfaceId: '1', portId: '1', which: 'outputGain', value: '0' },
	})
	check('port_gain still honours pre-dropdown button options', state.ports['1/1'].outputGain === 0)

	const beforeBadPort = einst.logs.length
	await eactions.port_gain.callback({ options: { port: 'garbage', which: 'outputGain', value: '0' } })
	check(
		'port_gain warns on an unparseable port instead of throwing',
		einst.logs.slice(beforeBadPort).some((l) => /warn/.test(l)),
	)

	// -----------------------------------------------------------------
	// Definitions refresh so dropdowns stay current
	// -----------------------------------------------------------------
	const sigBefore = choicesSignature(einst)
	check('signature is stable when nothing changed', choicesSignature(einst) === sigBefore)
	check('no re-register when nothing changed', einst.refreshDefinitionsIfChanged() === false)

	// Rename a pack the way an operator would in the CCM.
	einst.state.endpoints[0].label = 'Renamed Pack'
	check('signature changes when an endpoint is renamed', choicesSignature(einst) !== sigBefore)
	check('re-registers definitions after a rename', einst.refreshDefinitionsIfChanged() === true)
	check(
		'refreshed dropdown shows the new name',
		endpointChoices(einst).some((c) => /Renamed Pack/.test(c.label)),
	)

	// Going offline must also refresh, since the label gains an offline marker.
	const sigOnline = choicesSignature(einst)
	einst.state.endpoints[0].online = !einst.state.endpoints[0].online
	check('signature changes when an endpoint goes offline', choicesSignature(einst) !== sigOnline)

	// -----------------------------------------------------------------
	// Kill exceptions: array form (multi-select) and panic override
	// -----------------------------------------------------------------
	einst.state.endpoints = normaliseEndpoints([
		{ id: 11, label: 'Stage Manager', liveStatus: { status: 'online' } },
		{ id: 12, label: 'Camera 1', liveStatus: { status: 'online' } },
	])

	check(
		'exceptions accept the multi-select array form',
		[...einst.resolveKillExceptions(['11'])].join() === '11',
	)
	check(
		'exceptions accept multiple selected ids',
		[...einst.resolveKillExceptions(['11', '12'])].sort().join() === '11,12',
	)
	check('exceptions accept a legacy comma string', [...einst.resolveKillExceptions('11,12')].sort().join() === '11,12')
	check('exceptions match on endpoint name', [...einst.resolveKillExceptions(['Stage Manager'])].join() === '11')
	check('exceptions are case-insensitive on names', [...einst.resolveKillExceptions(['stage manager'])].join() === '11')
	check('empty array means no exceptions', einst.resolveKillExceptions([]).size === 0)
	check('empty string means no exceptions', einst.resolveKillExceptions('').size === 0)
	check(
		'unknown numeric id is still honoured as an exception',
		einst.resolveKillExceptions(['99']).has('99'),
	)

	const beforeUnmatched = einst.logs.length
	einst.resolveKillExceptions(['Nobody By That Name'])
	check(
		'unmatched exception name warns the operator',
		einst.logs.slice(beforeUnmatched).some((l) => /warn/.test(l)),
	)

	// Exempt endpoint must not receive an RMK; everyone else must.
	// Per-endpoint RMK hits /endpoints/:id/rmk, system-wide hits /endpoints/rmk.
	const rmkTargets = () =>
		calls
			.filter((c) => c.method === 'POST' && /\/endpoints\/(?:(\d+)\/)?rmk$/.test(c.url))
			.map((c) => c.url.match(/\/endpoints\/(?:(\d+)\/)?rmk$/)[1] ?? 'all')

	einst.config.killExceptIds = ['11']
	calls.length = 0
	await einst.setKill(true)
	einst.stopBurst()
	const targeted = rmkTargets()
	check('kill with an exception spares the exempt endpoint', !targeted.includes('11'), JSON.stringify(targeted))
	check('kill with an exception still kills the others', targeted.includes('12'), JSON.stringify(targeted))
	check(
		'kill with an exception never falls back to system-wide RMK',
		!targeted.includes('all'),
		JSON.stringify(targeted),
	)
	check('kill exception variable counts the exempt pack', Number(einst.variables.kill_except_count) === 1)
	check(
		'kill exception variable names the exempt pack',
		String(einst.variables.kill_except_labels).includes('Stage Manager'),
	)

	await einst.setKill(false)

	// Panic path: ignore exceptions entirely and use the system-wide RMK.
	calls.length = 0
	await einst.setKill(true, { respectExceptions: false })
	einst.stopBurst()
	const panicTargets = rmkTargets()
	check('panic kill ignores exceptions', panicTargets.includes('all'), JSON.stringify(panicTargets))
	const beforePanicLog = einst.logs.length
	await einst.setKill(false)
	await einst.setKill(true, { respectExceptions: false })
	einst.stopBurst()
	check(
		'panic kill logs that it is overriding exceptions',
		einst.logs.slice(beforePanicLog).some((l) => /ignoring configured kill exceptions/i.test(l)),
	)
	await einst.setKill(false)

	einst.config.killExceptIds = []

	await einst.destroy()

	server.close()

	console.log(`\n${'='.repeat(50)}`)
	console.log(`${pass} passed, ${fail} failed`)
	if (fail) {
		console.log('\nFailures:')
		failures.forEach((f) => console.log('  - ' + f))
		process.exit(1)
	}
	console.log('All instance tests passed.')
}

main().catch((e) => {
	console.error('Harness error:', e)
	process.exit(1)
})
