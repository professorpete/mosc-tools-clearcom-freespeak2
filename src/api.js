/**
 * Minimal HTTP client for the Clear-Com FreeSpeak II Base Station
 * Core Configuration Manager (CCM) API.
 *
 * Auth: HTTP Basic (default admin/admin).
 * All routes are under /api/1/ (a couple of device routes accept /api/2/).
 *
 * Uses Node's built-in fetch (Node 18+/22) so the module has no runtime
 * dependency beyond @companion-module/base.
 */

export class CcmClient {
	constructor(instance) {
		this.instance = instance
	}

	get config() {
		return this.instance.config ?? {}
	}

	get baseUrl() {
		const host = (this.config.host ?? '').trim()
		const port = Number(this.config.port) || 80
		const scheme = this.config.https ? 'https' : 'http'
		if (!host) return null
		// IPv6 literals need brackets
		const h = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
		const isDefault = (scheme === 'http' && port === 80) || (scheme === 'https' && port === 443)
		return isDefault ? `${scheme}://${h}` : `${scheme}://${h}:${port}`
	}

	get authHeader() {
		const user = this.config.username ?? 'admin'
		const pass = this.config.password ?? 'admin'
		return 'Basic ' + Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')
	}

	/**
	 * Perform a request against the CCM.
	 * @returns {Promise<{ok:boolean, status:number, data:any, error?:string}>}
	 */
	async request(method, path, body = undefined, { timeoutMs } = {}) {
		const base = this.baseUrl
		if (!base) {
			return { ok: false, status: 0, data: null, error: 'No base station IP configured' }
		}

		const url = `${base}${path}`
		const timeout = timeoutMs ?? (Number(this.config.timeout) || 5000)
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), timeout)

		const headers = {
			Authorization: this.authHeader,
			Accept: 'application/json, text/plain, */*',
		}
		let payload
		if (body !== undefined) {
			headers['Content-Type'] = 'application/json'
			payload = JSON.stringify(body)
		}

		try {
			this.instance.log('debug', `${method} ${url}${payload ? ` ${payload}` : ''}`)
			const res = await fetch(url, {
				method,
				headers,
				body: payload,
				signal: controller.signal,
				redirect: 'manual',
			})

			const text = await res.text()
			let data = null
			if (text) {
				try {
					data = JSON.parse(text)
				} catch {
					data = text
				}
			}

			if (res.status === 401) {
				return { ok: false, status: 401, data, error: 'Authentication failed - check username/password' }
			}

			return { ok: res.ok, status: res.status, data, error: res.ok ? undefined : `HTTP ${res.status}` }
		} catch (err) {
			const aborted = err?.name === 'AbortError'
			return {
				ok: false,
				status: 0,
				data: null,
				error: aborted ? `Timed out after ${timeout}ms` : (err?.message ?? String(err)),
			}
		} finally {
			clearTimeout(timer)
		}
	}

	get(path, opts) {
		return this.request('GET', path, undefined, opts)
	}
	post(path, body = {}, opts) {
		return this.request('POST', path, body, opts)
	}
	put(path, body = {}, opts) {
		return this.request('PUT', path, body, opts)
	}

	// ---------------------------------------------------------------
	// High level operations
	// ---------------------------------------------------------------

	/** Device list (also serves as our connectivity probe). */
	getDevices() {
		return this.get('/api/1/devices/')
	}

	/** All endpoints (beltpacks / wired stations / Agent-IC) for a device. */
	getEndpoints(deviceId = 1) {
		return this.get(`/api/1/devices/${deviceId}/endpoints/`)
	}

	/** Channels, groups and 4W direct connections. */
	getConnections() {
		return this.get('/api/1/connections/')
	}

	getConnectionsLive() {
		return this.get('/api/1/connections/liveStatus')
	}

	/**
	 * Remote Mic Kill.
	 *
	 * Omitting endpointId performs a SYSTEM-WIDE RMK: every latched talk key
	 * on every beltpack and wired station is released. This mirrors the CCM's
	 * "RMK All" control, which posts to the endpoints collection with no
	 * endpoint id and deviceId defaulted to 1.
	 */
	rmk(deviceId = 1, endpointId = null) {
		const path =
			endpointId === null || endpointId === undefined || endpointId === ''
				? `/api/1/devices/${deviceId}/endpoints/rmk`
				: `/api/1/devices/${deviceId}/endpoints/${endpointId}/rmk`
		return this.post(path, {})
	}

	/** Call signal to an endpoint (or all, when endpointId omitted). */
	callSignal(deviceId = 1, endpointId = null, active = true, text = '') {
		const path =
			endpointId === null || endpointId === undefined || endpointId === ''
				? `/api/1/devices/${deviceId}/endpoints/call`
				: `/api/1/devices/${deviceId}/endpoints/${endpointId}/call`
		return this.post(path, { active, text })
	}

	/**
	 * Force a GPO relay.
	 * enabled = true/false forces the relay; null releases the override
	 * and returns the relay to normal (event driven) operation.
	 */
	setGpo(deviceId = 1, id, enabled) {
		return this.post(`/api/1/devices/${deviceId}/setGPO`, { id: Number(id), enabled })
	}

	/** Force a GPI (virtual trigger). null releases the override. */
	setGpi(deviceId = 1, id, enabled) {
		return this.post(`/api/1/devices/${deviceId}/setGPI`, { id: Number(id), enabled })
	}

	getGpio(deviceId = 0) {
		return this.get(`/api/1/devices/${deviceId}/gpio`)
	}

	/** Update a port (used for gain ducking). */
	updatePort(deviceId, interfaceId, portId, settings) {
		return this.put(`/api/1/devices/${deviceId}/interfaces/${interfaceId}/ports/${portId}`, settings)
	}

	getInterfaces(deviceId = 1, interfaceId = '') {
		return this.get(`/api/1/devices/${deviceId}/interfaces/${interfaceId}`)
	}

	rebootEndpoint(deviceId = 1, endpointId) {
		return this.post(`/api/1/devices/${deviceId}/endpoints/${endpointId}/reboot`, {})
	}
}
