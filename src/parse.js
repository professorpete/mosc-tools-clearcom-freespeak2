/**
 * Normalisers for CCM API responses.
 *
 * The CCM's JSON shape varies between firmware revisions (and between
 * FSII / HelixNet builds that share the same web app), so every accessor
 * here is defensive: we probe several plausible field names and fall back
 * to sane defaults rather than throwing. A parse miss must never stop the
 * kill switch from working.
 */

function asArray(data, ...keys) {
	if (Array.isArray(data)) return data
	if (data && typeof data === 'object') {
		for (const k of keys) {
			if (Array.isArray(data[k])) return data[k]
		}
		// Some responses are keyed objects: { "1": {...}, "2": {...} }
		const vals = Object.values(data)
		if (vals.length && vals.every((v) => v && typeof v === 'object')) return vals
	}
	return []
}

function pick(obj, ...keys) {
	for (const k of keys) {
		if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k]
	}
	return undefined
}

/** Device name / firmware version from /api/1/devices/ */
export function normaliseDevice(data, deviceId = 1) {
	const devices = asArray(data, 'devices')
	const dev =
		devices.find((d) => String(pick(d, 'device_id', 'id')) === String(deviceId)) ?? devices[0] ?? {}

	const live = pick(dev, 'device_liveStatus', 'liveStatus') ?? {}
	const settings = pick(dev, 'device_settings', 'settings') ?? {}

	return {
		name: String(pick(dev, 'device_label', 'label', 'name') ?? ''),
		version:
			String(
				pick(live, 'osVersion', 'version', 'softwareVersion') ??
					pick(settings, 'version', 'softwareVersion') ??
					pick(dev, 'device_version', 'version') ??
					'',
			) || '',
		raw: dev,
	}
}

/**
 * Endpoints = beltpacks, wired stations, Agent-IC clients.
 * We derive: id, label, online, talking, battery, rf.
 */
export function normaliseEndpoints(data) {
	const list = asArray(data, 'endpoints')

	return list
		.map((ep) => {
			const id = pick(ep, 'id', 'endpoint_id', 'endpointId')
			if (id === undefined) return null

			const live = pick(ep, 'liveStatus', 'endpoint_liveStatus') ?? {}
			const details = pick(ep, 'details', 'endpoint_details') ?? {}

			const status = String(pick(live, 'status') ?? '').toLowerCase()
			const onlineFlag = pick(live, 'online')
			const online =
				onlineFlag !== undefined
					? !!onlineFlag
					: status
						? status !== 'offline' && status !== 'unregistered'
						: false

			// Talk state: keyState is an array of per-keyset entries when present.
			let talking = false
			const keyState = pick(live, 'keyState')
			if (Array.isArray(keyState)) {
				talking = keyState.some((k) => {
					if (!k || typeof k !== 'object') return false
					const t = pick(k, 'talk', 'talkState', 'talkActive', 'active', 'state')
					if (typeof t === 'boolean') return t
					if (typeof t === 'number') return t > 0
					if (typeof t === 'string') return ['talk', 'active', 'on', 'true'].includes(t.toLowerCase())
					return false
				})
			}
			// Fallbacks used by some builds
			if (!talking) {
				const vox = pick(live, 'vox')
				if (typeof vox === 'boolean') talking = vox
			}

			const battery = pick(details, 'batteryLevel') ?? pick(live, 'batteryLevel', 'battery')
			const rf =
				pick(details, 'linkQuality') ??
				pick(details, 'RSSI') ??
				pick(live, 'networkQuality', 'linkQuality')

			return {
				id,
				label: String(pick(ep, 'label', 'endpoint_label', 'name') ?? `Endpoint ${id}`),
				type: String(pick(ep, 'type', 'endpointType_name', 'deviceType_name') ?? ''),
				online,
				talking,
				status,
				battery: battery === undefined ? '' : battery,
				rf: rf === undefined ? '' : rf,
			}
		})
		.filter((x) => x !== null)
}

/**
 * GPIO state from /api/1/devices/0/gpio
 * Returns { gpo: {id: bool}, gpi: {id: bool} }
 */
export function normaliseGpio(data) {
	const gpo = {}
	const gpi = {}

	const collect = (items, target) => {
		for (const item of items) {
			const id = pick(item, 'id', 'gpioId')
			if (id === undefined) continue
			const live = pick(item, 'liveStatus') ?? {}
			const st = pick(live, 'status', 'state')
			if (typeof st === 'boolean') target[id] = st
			else if (typeof st === 'number') target[id] = st > 0
			else if (typeof st === 'string') target[id] = ['true', 'on', 'active', 'closed'].includes(st.toLowerCase())
		}
	}

	if (data && typeof data === 'object' && !Array.isArray(data)) {
		collect(asArray(data.gpos ?? data.gpo ?? []), gpo)
		collect(asArray(data.gpis ?? data.gpi ?? []), gpi)
	}

	// Flat array with a type discriminator
	const flat = Array.isArray(data) ? data : asArray(data, 'gpios')
	for (const item of flat) {
		const type = String(pick(item, 'type') ?? '').toLowerCase()
		if (type === 'gpo') collect([item], gpo)
		else if (type === 'gpi') collect([item], gpi)
	}

	return { gpo, gpi }
}
