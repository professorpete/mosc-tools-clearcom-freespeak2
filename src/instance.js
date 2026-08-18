import { InstanceBase, InstanceStatus } from '@companion-module/base'
import { CcmClient } from './api.js'
import { getConfigFields } from './config.js'
import { getActions } from './actions.js'
import { getFeedbacks } from './feedbacks.js'
import { getPresets } from './presets.js'
import { getVariableDefinitions, buildVariableValues } from './variables.js'
import { normaliseEndpoints, normaliseGpio, normaliseDevice } from './parse.js'

export class FreeSpeak2Instance extends InstanceBase {
	constructor(internal) {
		super(internal)

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

	get deviceId() {
		const v = Number(this.config?.deviceId)
		return Number.isFinite(v) ? v : 1
	}

	// -----------------------------------------------------------------
	// Lifecycle
	// -----------------------------------------------------------------
	async init(config) {
		this.config = config
		this.updateStatus(InstanceStatus.Connecting)

		this.rebuildDefinitions()

		if (!this.config?.host) {
			this.updateStatus(InstanceStatus.BadConfig, 'No base station IP configured')
			return
		}

		await this.poll(true)
		this.startPolling()
	}

	async configUpdated(config) {
		this.config = config
		this.stopPolling()
		this.stopBurst()
		this.updateStatus(InstanceStatus.Connecting)

		if (!this.config?.host) {
			this.updateStatus(InstanceStatus.BadConfig, 'No base station IP configured')
			return
		}

		await this.poll(true)
		this.startPolling()
	}

	async destroy() {
		this.stopPolling()
		this.stopBurst()
	}

	getConfigFields() {
		return getConfigFields()
	}

	rebuildDefinitions() {
		this.setActionDefinitions(getActions(this))
		this.setFeedbackDefinitions(getFeedbacks(this))
		this.setPresetDefinitions(getPresets())
		this.setVariableDefinitions(getVariableDefinitions(this))
		this.syncVariables()
	}

	syncVariables() {
		this.setVariableValues(buildVariableValues(this))
	}

	checkAllFeedbacks() {
		this.checkFeedbacks(
			'killed',
			'kill_flash',
			'connected',
			'gpo_state',
			'endpoint_talking',
			'endpoint_online',
			'any_talking',
		)
	}

	// -----------------------------------------------------------------
	// Polling
	// -----------------------------------------------------------------
	startPolling() {
		const interval = Number(this.config?.pollInterval)
		if (!interval || interval <= 0) return
		this.stopPolling()
		this.pollTimer = setInterval(() => {
			this.poll(false).catch((e) => this.log('debug', `Poll error: ${e?.message ?? e}`))
		}, Math.max(500, interval))
	}

	stopPolling() {
		if (this.pollTimer) {
			clearInterval(this.pollTimer)
			this.pollTimer = null
		}
	}

	/**
	 * Refresh device, endpoint and GPIO state.
	 * Endpoint/GPIO failures are tolerated - some firmware builds and
	 * licence levels expose fewer routes, and the kill switch must keep
	 * working even when the status extras are unavailable.
	 */
	async poll(initial = false) {
		if (this.pollInFlight) return
		this.pollInFlight = true

		try {
			const devRes = await this.client.getDevices()

			if (!devRes.ok) {
				this.state.connected = false
				this.state.lastError = devRes.error ?? 'Unknown error'
				if (devRes.status === 401) {
					this.updateStatus(InstanceStatus.AuthenticationFailure, 'Check CCM username / password')
				} else {
					this.updateStatus(InstanceStatus.ConnectionFailure, devRes.error ?? 'No response')
				}
				this.syncVariables()
				this.checkAllFeedbacks()
				return
			}

			if (!this.state.connected) {
				this.log('info', 'Connected to FreeSpeak II base station')
			}
			this.state.connected = true
			this.state.lastError = ''
			this.updateStatus(InstanceStatus.Ok)

			const dev = normaliseDevice(devRes.data, this.deviceId)
			this.state.deviceName = dev.name
			this.state.deviceVersion = dev.version

			// Endpoints (beltpacks / wired stations)
			const epRes = await this.client.getEndpoints(this.deviceId)
			if (epRes.ok) {
				const endpoints = normaliseEndpoints(epRes.data)
				const sig = endpoints.map((e) => `${e.id}:${e.label}`).join('|')
				this.state.endpoints = endpoints
				if (sig !== this.endpointSignature) {
					this.endpointSignature = sig
					// Endpoint list changed -> rebuild dropdowns and variables
					this.setActionDefinitions(getActions(this))
					this.setFeedbackDefinitions(getFeedbacks(this))
					this.setVariableDefinitions(getVariableDefinitions(this))
				}
			} else if (initial) {
				this.log('debug', `Could not read endpoints: ${epRes.error}. Kill switch still works.`)
			}

			// GPIO
			const gpioRes = await this.client.getGpio(0)
			if (gpioRes.ok) {
				const { gpo, gpi } = normaliseGpio(gpioRes.data)
				this.state.gpo = { ...this.state.gpo, ...gpo }
				this.state.gpi = { ...this.state.gpi, ...gpi }
			}

			this.syncVariables()
			this.checkAllFeedbacks()
		} finally {
			this.pollInFlight = false
		}
	}

	// -----------------------------------------------------------------
	// Result handling
	// -----------------------------------------------------------------
	handleResult(res, description) {
		if (res.ok) {
			if (this.config?.verbose) this.log('info', `OK: ${description}`)
			return true
		}
		this.state.lastError = `${description}: ${res.error}`
		this.log('error', `Failed: ${description} - ${res.error}`)
		if (res.status === 401) {
			this.updateStatus(InstanceStatus.AuthenticationFailure, 'Check CCM username / password')
		} else if (res.status === 0) {
			this.updateStatus(InstanceStatus.ConnectionFailure, res.error)
			this.state.connected = false
		}
		this.syncVariables()
		return false
	}

	// -----------------------------------------------------------------
	// RMK
	// -----------------------------------------------------------------
	async doRmk(endpointId = null) {
		const res = await this.client.rmk(this.deviceId, endpointId)
		const label = endpointId === null ? 'ALL endpoints' : `endpoint ${endpointId}`
		const ok = this.handleResult(res, `RMK ${label}`)
		if (ok) {
			this.state.killCount += 1
			this.state.lastKillTime = new Date().toLocaleTimeString()
			// Optimistically clear talk state so the UI reacts instantly;
			// the next poll confirms it from the base station.
			if (endpointId === null) {
				for (const ep of this.state.endpoints) ep.talking = false
			} else {
				const ep = this.state.endpoints.find((e) => String(e.id) === String(endpointId))
				if (ep) ep.talking = false
			}
			this.syncVariables()
			this.checkAllFeedbacks()
		}
		return ok
	}

	/**
	 * Fire RMK repeatedly for durationMs.
	 * @returns {Promise<boolean>} whether the FIRST RMK succeeded
	 */
	async rmkBurst(durationMs = 3000, intervalMs = 500) {
		this.stopBurst()
		this.state.killBurstActive = true
		this.checkFeedbacks('kill_flash')

		const firstOk = await this.doRmk(null)

		if (durationMs > 0) {
			this.burstTimer = setInterval(() => {
				this.doRmk(null).catch(() => {})
			}, Math.max(100, intervalMs))

			this.burstEndTimer = setTimeout(() => {
				this.stopBurst()
			}, durationMs)
		} else {
			this.state.killBurstActive = false
			this.checkFeedbacks('kill_flash')
		}

		return firstOk
	}

	stopBurst() {
		if (this.burstTimer) {
			clearInterval(this.burstTimer)
			this.burstTimer = null
		}
		if (this.burstEndTimer) {
			clearTimeout(this.burstEndTimer)
			this.burstEndTimer = null
		}
		if (this.state.killBurstActive) {
			this.state.killBurstActive = false
			this.checkFeedbacks('kill_flash')
		}
	}

	// -----------------------------------------------------------------
	// GPO
	// -----------------------------------------------------------------
	async doSetGpo(id, enabled) {
		const res = await this.client.setGpo(this.deviceId, id, enabled)
		const ok = this.handleResult(res, `Set GPO ${id} to ${enabled === null ? 'released' : enabled}`)
		if (ok) {
			if (enabled === null) delete this.state.gpo[id]
			else this.state.gpo[id] = enabled
			this.syncVariables()
			this.checkFeedbacks('gpo_state')
		}
		return ok
	}

	parseIdList(str) {
		return String(str ?? '')
			.split(',')
			.map((s) => Number(s.trim()))
			.filter((n) => Number.isFinite(n) && n > 0)
	}

	// -----------------------------------------------------------------
	// The kill switch
	// -----------------------------------------------------------------
	async setKill(kill, { useGpo = false, duckPorts = false } = {}) {
		if (kill) {
			this.log('warn', 'COMMS KILL engaged')

			// 1. RMK - release every latched talk key, immediately.
			const holdMs = Number(this.config?.killHoldMs ?? 3000)
			const rmkOk = await this.rmkBurst(holdMs, 400)

			// 2. Optional GPO hard cut.
			let gpoOk = true
			if (useGpo) {
				const ids = this.parseIdList(this.config?.killGpoIds ?? '1')
				const target = String(this.config?.killGpoState ?? 'true') === 'true'
				for (const id of ids) {
					const ok = await this.doSetGpo(id, target)
					if (!ok) gpoOk = false
				}
			}

			// 3. Optional port gain duck, saving current values for restore.
			if (duckPorts) {
				await this.duckPorts()
			}

			// A kill switch must never claim success it did not achieve.
			// If nothing we attempted actually reached the base station, stay
			// un-killed and shout about it, so the operator does not trust a
			// red button that did nothing.
			const anySucceeded = rmkOk || (useGpo && gpoOk) || (duckPorts && this.state.savedGains.length > 0)
			if (!anySucceeded) {
				this.state.killed = false
				this.log('error', 'COMMS KILL FAILED - the base station did not accept the kill. Comms are still live.')
				this.stopBurst()
				this.syncVariables()
				this.checkAllFeedbacks()
				return false
			}

			this.state.killed = true
		} else {
			this.log('info', 'COMMS KILL released')
			this.stopBurst()

			if (useGpo) {
				const ids = this.parseIdList(this.config?.killGpoIds ?? '1')
				for (const id of ids) {
					// Release the override so the relay returns to normal operation.
					await this.doSetGpo(id, null)
				}
			}

			if (this.state.savedGains.length) {
				await this.restorePorts()
			}

			this.state.killed = false
		}

		this.syncVariables()
		this.checkAllFeedbacks()
		return true
	}

	/** Floor output gain on every 4-wire style port, remembering prior values. */
	async duckPorts() {
		const res = await this.client.getInterfaces(this.deviceId)
		if (!res.ok || !res.data) {
			this.log('warn', `Port duck skipped: could not read interfaces (${res.error})`)
			return
		}

		const interfaces = Array.isArray(res.data) ? res.data : (res.data.interfaces ?? [])
		const saved = []

		for (const iface of interfaces) {
			const ifaceId = iface.id ?? iface.audioInterface_id
			const shortName = iface.audioInterfaceType_shortName ?? iface.type ?? ''
			const floor = shortName === '2W' ? -3 : -12
			const ports = iface.ports ?? []
			for (const port of ports) {
				const portId = port.id ?? port.port_id
				if (portId === undefined) continue
				const current = port.settings?.outputGain ?? port.outputGain
				const upd = await this.client.updatePort(this.deviceId, ifaceId, portId, {
					settings: { outputGain: floor },
				})
				if (upd.ok) {
					saved.push({ ifaceId, portId, outputGain: current })
				}
			}
		}

		this.state.savedGains = saved
		this.log('info', `Ducked ${saved.length} port(s)`)
	}

	async restorePorts() {
		for (const entry of this.state.savedGains) {
			if (entry.outputGain === undefined || entry.outputGain === null) continue
			await this.client.updatePort(this.deviceId, entry.ifaceId, entry.portId, {
				settings: { outputGain: entry.outputGain },
			})
		}
		this.log('info', `Restored ${this.state.savedGains.length} port gain(s)`)
		this.state.savedGains = []
	}
}
