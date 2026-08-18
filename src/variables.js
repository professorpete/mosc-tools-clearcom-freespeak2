export function getVariableDefinitions(self) {
	const defs = [
		{ variableId: 'connected', name: 'Base station reachable (true/false)' },
		{ variableId: 'device_name', name: 'Base station name' },
		{ variableId: 'device_version', name: 'Base station firmware version' },
		{ variableId: 'killed', name: 'Comms kill engaged (true/false)' },
		{ variableId: 'kill_count', name: 'Number of kills sent this session' },
		{ variableId: 'last_kill_time', name: 'Time of last kill' },
		{ variableId: 'last_error', name: 'Last API error' },
		{ variableId: 'endpoints_total', name: 'Endpoints configured' },
		{ variableId: 'endpoints_online', name: 'Endpoints online' },
		{ variableId: 'endpoints_talking', name: 'Endpoints with an active talk key' },
		{ variableId: 'talking_labels', name: 'Labels of endpoints currently talking' },
	]

	for (let i = 1; i <= 4; i++) {
		defs.push({ variableId: `gpo_${i}`, name: `GPO ${i} state` })
	}
	for (let i = 1; i <= 2; i++) {
		defs.push({ variableId: `gpi_${i}`, name: `GPI ${i} state` })
	}

	// Per-endpoint variables, built from whatever the base station reports.
	for (const ep of self.state.endpoints) {
		defs.push({ variableId: `ep_${ep.id}_label`, name: `Endpoint ${ep.id} label` })
		defs.push({ variableId: `ep_${ep.id}_online`, name: `Endpoint ${ep.id} online` })
		defs.push({ variableId: `ep_${ep.id}_talking`, name: `Endpoint ${ep.id} talking` })
		defs.push({ variableId: `ep_${ep.id}_battery`, name: `Endpoint ${ep.id} battery %` })
		defs.push({ variableId: `ep_${ep.id}_rf`, name: `Endpoint ${ep.id} RF / network quality` })
	}

	return defs
}

export function buildVariableValues(self) {
	const s = self.state
	const talking = s.endpoints.filter((e) => e.talking === true)

	const values = {
		connected: String(!!s.connected),
		device_name: s.deviceName ?? '',
		device_version: s.deviceVersion ?? '',
		killed: String(!!s.killed),
		kill_count: s.killCount ?? 0,
		last_kill_time: s.lastKillTime ?? '',
		last_error: s.lastError ?? '',
		endpoints_total: s.endpoints.length,
		endpoints_online: s.endpoints.filter((e) => e.online === true).length,
		endpoints_talking: talking.length,
		talking_labels: talking.map((e) => e.label ?? e.id).join(', '),
	}

	for (let i = 1; i <= 4; i++) {
		values[`gpo_${i}`] = s.gpo[i] === undefined ? 'unknown' : String(s.gpo[i])
	}
	for (let i = 1; i <= 2; i++) {
		values[`gpi_${i}`] = s.gpi[i] === undefined ? 'unknown' : String(s.gpi[i])
	}

	for (const ep of s.endpoints) {
		values[`ep_${ep.id}_label`] = ep.label ?? ''
		values[`ep_${ep.id}_online`] = String(!!ep.online)
		values[`ep_${ep.id}_talking`] = String(!!ep.talking)
		values[`ep_${ep.id}_battery`] = ep.battery ?? ''
		values[`ep_${ep.id}_rf`] = ep.rf ?? ''
	}

	return values
}
