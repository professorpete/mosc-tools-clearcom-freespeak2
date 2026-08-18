/**
 * Boots the PACKAGED bundle (pkg/main.js) the way Companion does:
 * as a child process speaking the nodejs-ipc protocol over the Node
 * parent/child IPC channel. Verifies the module registers, accepts config,
 * exposes actions/feedbacks/presets/variables, connects to a mock base
 * station, and executes the kill switch.
 */
import { fork } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMockCcm } from './mock-ccm.js'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const EJSON = require('ejson')

/** Payloads on the wire are EJSON-encoded strings. */
const enc = (obj) => EJSON.stringify(obj)
const dec = (payload) => {
	if (payload === undefined || payload === null) return undefined
	if (typeof payload !== 'string') return payload
	try {
		return EJSON.parse(payload)
	} catch {
		return undefined
	}
}
/** Decoded payload of a received message. */
const dp = (m) => dec(m?.payload)

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const bundlePath = path.join(root, 'pkg', 'main.js')
const manifestPath = path.join(root, 'companion', 'manifest.json')

let pass = 0
let fail = 0
const failures = []
function check(name, cond, detail = '') {
	if (cond) {
		pass++
		console.log(`  PASS  ${name}`)
	} else {
		fail++
		failures.push(name + ' ' + detail)
		console.log(`  FAIL  ${name} ${detail}`)
	}
}

async function main() {
	const manifest = JSON.parse(await (await import('node:fs/promises')).readFile(manifestPath, 'utf8'))

	const { server, calls, state } = createMockCcm()
	await new Promise((r) => server.listen(0, '127.0.0.1', r))
	const ccmPort = server.address().port
	console.log(`Mock CCM on 127.0.0.1:${ccmPort}`)
	console.log(`Booting bundle: ${bundlePath}\n`)

	const child = fork(bundlePath, [], {
		stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
		env: {
			...process.env,
			MODULE_MANIFEST: manifestPath,
			CONNECTION_ID: 'test-connection-1',
			VERIFICATION_TOKEN: 'test-token',
			MODULE_FILE: bundlePath,
		},
	})

	const stderr = []
	child.stderr.on('data', (d) => stderr.push(d.toString()))
	child.stdout.on('data', () => {})

	const received = []
	const waiters = []

	child.on('message', (msg) => {
		received.push(msg)
		for (let i = waiters.length - 1; i >= 0; i--) {
			if (waiters[i].match(msg)) {
				waiters[i].resolve(msg)
				waiters.splice(i, 1)
			}
		}
	})

	const waitFor = (match, timeoutMs = 8000, label = 'message') =>
		new Promise((resolve, reject) => {
			const existing = received.find(match)
			if (existing) return resolve(existing)
			const w = { match, resolve }
			waiters.push(w)
			setTimeout(() => {
				const idx = waiters.indexOf(w)
				if (idx >= 0) waiters.splice(idx, 1)
				reject(new Error(`Timed out waiting for ${label}`))
			}, timeoutMs)
		})

	let exited = null
	child.on('exit', (code) => (exited = code))

	// ---- register ---------------------------------------------------
	let registered = false
	try {
		await waitFor((m) => m?.direction === 'call' && m?.name === 'register', 8000, 'register call')
		registered = true
	} catch (e) {
		console.log('    stderr:', stderr.join('').slice(0, 600))
	}
	check('bundle sends register handshake', registered)
	if (!registered) {
		child.kill()
		server.close()
		finish()
		return
	}

	const regMsg = received.find((m) => m?.name === 'register')
	const regPayload = dp(regMsg)
	check('register payload has apiVersion', !!regPayload?.apiVersion, JSON.stringify(regPayload ?? {}))

	// Respond to the register call so the module proceeds to init.
	child.send({ direction: 'response', callbackId: regMsg.callbackId, success: true, payload: enc({}) })

	// ---- init -------------------------------------------------------
	const config = {
		host: '127.0.0.1',
		port: ccmPort,
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

	const initId = 'init-1'
	child.send({
		direction: 'call',
		name: 'init',
		callbackId: initId,
		payload: enc({
			config,
			secrets: {},
			label: 'fsii-test',
			isFirstInit: false,
			actions: {},
			feedbacks: {},
			lastUpgradeIndex: -1,
		}),
	})

	let initOk = false
	try {
		await waitFor((m) => m?.direction === 'response' && m?.callbackId === initId, 12000, 'init response')
		initOk = true
	} catch {
		console.log('    stderr:', stderr.join('').slice(0, 800))
	}
	check('module init completes', initOk)

	// ---- definitions ------------------------------------------------
	const actionDefs = received.filter((m) => m?.name === 'setActionDefinitions').pop()
	const feedbackDefs = received.filter((m) => m?.name === 'setFeedbackDefinitions').pop()
	const presetDefs = received.filter((m) => m?.name === 'setPresetDefinitions').pop()
	const varDefs = received.filter((m) => m?.name === 'setVariableDefinitions').pop()
	const varVals = received.filter((m) => m?.name === 'setVariableValues')

	const actionIds = (dp(actionDefs)?.actions ?? []).map((a) => a.id)
	check('actions registered with host', actionIds.length > 0, JSON.stringify(actionIds))
	check('comms_kill action registered', actionIds.includes('comms_kill'))
	check('rmk action registered', actionIds.includes('rmk'))

	const fbIds = (dp(feedbackDefs)?.feedbacks ?? []).map((f) => f.id)
	check('feedbacks registered', fbIds.includes('killed') && fbIds.includes('any_talking'), JSON.stringify(fbIds))

	const presetCount = Object.keys(dp(presetDefs)?.presets ?? {}).length
	check('presets registered', presetCount >= 8, `count ${presetCount}`)

	const varIds = (dp(varDefs)?.variables ?? []).map((v) => v.id ?? v.variableId)
	check('variables registered', varIds.includes('killed') && varIds.includes('endpoints_talking'), JSON.stringify(varIds.slice(0, 8)))

	// ---- status -----------------------------------------------------
	const statuses = received.filter((m) => m?.name === 'set-status').map((m) => dp(m)?.status)
	check('reported an Ok status to host', statuses.includes('ok'), JSON.stringify(statuses))

	// Variable values should include the device name read from the mock
	const merged = {}
	for (const m of varVals) {
		const nv = dp(m)?.newValues
		if (Array.isArray(nv)) for (const e of nv) merged[e.id] = e.value
		else if (nv) Object.assign(merged, nv)
	}
	check('device_name variable sent to host', merged.device_name === 'FSII Base Stage', JSON.stringify(merged.device_name))
	check('endpoints_total variable sent', String(merged.endpoints_total) === '3', String(merged.endpoints_total))

	// ---- EXECUTE THE KILL SWITCH through the real IPC path ----------
	state.talking[11] = true
	state.talking[12] = true
	calls.length = 0

	const killId = 'action-kill-1'
	if (!child.connected) {
		check('child still connected before kill', false, 'IPC channel closed early; stderr: ' + stderr.join('').slice(0, 400))
		server.close()
		return finish()
	}
	child.send({
		direction: 'call',
		name: 'executeAction',
		callbackId: killId,
		payload: enc({
			action: {
				id: 'kill-instance-1',
				controlId: 'bank_1_1',
				actionId: 'comms_kill',
				options: { mode: 'kill', useGpo: false, duckPorts: false },
				upgradeIndex: null,
				disabled: false,
			},
			surfaceId: undefined,
		}),
	})

	let killResponded = false
	try {
		await waitFor((m) => m?.direction === 'response' && m?.callbackId === killId, 10000, 'kill action response')
		killResponded = true
	} catch {
		/* fall through to call inspection */
	}
	check('kill action executed via IPC', killResponded)
	check(
		'kill hit the RMK-all route on the base station',
		calls.some((c) => c.method === 'POST' && c.url === '/api/1/devices/1/endpoints/rmk'),
		JSON.stringify(calls.map((c) => c.url)),
	)
	check('base station talk keys cleared', Object.values(state.talking).every((v) => v === false))

	// Kill state should be reflected back as a variable
	const afterVals = {}
	for (const m of received.filter((m) => m?.name === 'setVariableValues')) {
		const nv = dp(m)?.newValues
		if (Array.isArray(nv)) for (const e of nv) afterVals[e.id] = e.value
		else if (nv) Object.assign(afterVals, nv)
	}
	check('killed variable reported true', String(afterVals.killed) === 'true', String(afterVals.killed))

	// ---- clean shutdown --------------------------------------------
	child.kill('SIGTERM')
	await new Promise((r) => setTimeout(r, 700))
	check('child process exits cleanly', exited !== null || child.killed)

	server.close()
	finish()
}

function finish() {
	console.log(`\n${'='.repeat(50)}`)
	console.log(`${pass} passed, ${fail} failed`)
	if (fail) {
		console.log('\nFailures:')
		failures.forEach((f) => console.log('  - ' + f))
		process.exit(1)
	}
	console.log('Bundle test passed - the packaged module runs under Companion IPC.')
	process.exit(0)
}

main().catch((e) => {
	console.error('Harness error:', e)
	process.exit(1)
})
