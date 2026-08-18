/**
 * Mock FreeSpeak II CCM server.
 * Mimics the real base station API surface (Basic auth + /api/1 routes)
 * so the module can be exercised without hardware.
 */
import http from 'node:http'

export function createMockCcm({ user = 'admin', pass = 'admin' } = {}) {
	const calls = []
	const state = {
		gpo: { 1: false, 2: false, 3: false, 4: false },
		gpi: { 1: false, 2: false },
		talking: { 11: true, 12: true, 13: false },
		ports: { '1/1': { outputGain: 6 }, '1/2': { outputGain: 0 } },
	}

	const server = http.createServer((req, res) => {
		let body = ''
		req.on('data', (c) => (body += c))
		req.on('end', () => {
			const auth = req.headers.authorization ?? ''
			const expect = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64')
			if (auth !== expect) {
				res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="CCM"' })
				return res.end('Unauthorized')
			}

			let parsed = null
			try {
				parsed = body ? JSON.parse(body) : null
			} catch {
				parsed = body
			}
			calls.push({ method: req.method, url: req.url, body: parsed })

			const json = (obj, code = 200) => {
				res.writeHead(code, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify(obj))
			}

			const u = req.url

			// Devices
			if (req.method === 'GET' && u === '/api/1/devices/') {
				return json([
					{
						device_id: 1,
						device_label: 'FSII Base Stage',
						device_liveStatus: { status: 'online', os: 'FSII', osVersion: '1.6.15' },
						device_settings: {},
					},
				])
			}

			// Endpoints
			if (req.method === 'GET' && u === '/api/1/devices/1/endpoints/') {
				return json([
					{
						id: 11,
						label: 'BP1 Stage Left',
						type: 'FSII-BP',
						liveStatus: {
							status: 'online',
							keyState: [{ keysetIndex: 1, talk: state.talking[11] }],
						},
						details: { batteryLevel: 82, linkQuality: 95 },
					},
					{
						id: 12,
						label: 'BP2 Camera',
						type: 'FSII-BP',
						liveStatus: {
							status: 'online',
							keyState: [{ keysetIndex: 1, talk: state.talking[12] }],
						},
						details: { batteryLevel: 47, linkQuality: 88 },
					},
					{
						id: 13,
						label: 'BP3 Spare',
						type: 'FSII-BP',
						liveStatus: { status: 'offline', keyState: [] },
						details: {},
					},
				])
			}

			// RMK all
			if (req.method === 'POST' && u === '/api/1/devices/1/endpoints/rmk') {
				for (const k of Object.keys(state.talking)) state.talking[k] = false
				return json({ success: true })
			}
			// RMK single
			let m = u.match(/^\/api\/1\/devices\/1\/endpoints\/(\d+)\/rmk$/)
			if (req.method === 'POST' && m) {
				state.talking[m[1]] = false
				return json({ success: true })
			}

			// Call signal
			if (req.method === 'POST' && /^\/api\/1\/devices\/1\/endpoints\/(\d+\/)?call$/.test(u)) {
				return json({ success: true })
			}

			// Reboot endpoint
			if (req.method === 'POST' && /^\/api\/1\/devices\/1\/endpoints\/\d+\/reboot$/.test(u)) {
				return json({ success: true })
			}

			// GPO / GPI
			if (req.method === 'POST' && u === '/api/1/devices/1/setGPO') {
				const { id, enabled } = parsed ?? {}
				if (enabled === null) state.gpo[id] = false
				else state.gpo[id] = !!enabled
				return json({ success: true })
			}
			if (req.method === 'POST' && u === '/api/1/devices/1/setGPI') {
				const { id, enabled } = parsed ?? {}
				if (enabled === null) state.gpi[id] = false
				else state.gpi[id] = !!enabled
				return json({ success: true })
			}
			if (req.method === 'GET' && u === '/api/1/devices/0/gpio') {
				return json({
					gpos: Object.entries(state.gpo).map(([id, st]) => ({
						id: Number(id),
						type: 'gpo',
						liveStatus: { status: st },
					})),
					gpis: Object.entries(state.gpi).map(([id, st]) => ({
						id: Number(id),
						type: 'gpi',
						liveStatus: { status: st },
					})),
				})
			}

			// Interfaces (for port ducking)
			if (req.method === 'GET' && u === '/api/1/devices/1/interfaces/') {
				return json([
					{
						id: 1,
						audioInterfaceType_shortName: '4W',
						ports: [
							{ id: 1, settings: { outputGain: state.ports['1/1'].outputGain } },
							{ id: 2, settings: { outputGain: state.ports['1/2'].outputGain } },
						],
					},
				])
			}

			// Port update
			m = u.match(/^\/api\/1\/devices\/1\/interfaces\/(\d+)\/ports\/(\d+)$/)
			if (req.method === 'PUT' && m) {
				const key = `${m[1]}/${m[2]}`
				if (parsed?.settings?.outputGain !== undefined) {
					state.ports[key].outputGain = parsed.settings.outputGain
				}
				return json({ success: true })
			}

			// Connections
			if (req.method === 'GET' && u === '/api/1/connections/') {
				return json([
					{ id: 1, label: 'Channel 1', type: 'partyline' },
					{ id: 2, label: 'Channel 2', type: 'partyline' },
				])
			}

			res.writeHead(404, { 'Content-Type': 'application/json' })
			res.end(JSON.stringify({ message: 'Not found' }))
		})
	})

	return { server, calls, state }
}
