/**
 * Shared dropdown choice builders.
 *
 * Every list here is built from live state polled off the base station, so the
 * dropdowns in Companion show real beltpack and station names rather than bare
 * numeric IDs. The instance re-registers its action/feedback definitions
 * whenever this data changes (see Instance#refreshDefinitionsIfChanged), which
 * is what makes the dropdowns update themselves as packs come and go.
 *
 * All of these are paired with `allowCustom: true` at the call site so an
 * operator can still type an ID or a $(variable) for a pack that is powered
 * off, or when building a page before the base station is reachable.
 */

export const ENDPOINT_ALL = '__all__'

/** Regex Companion uses to validate a custom-entered endpoint id. */
export const ID_REGEX = '/^\\d*$/'

/**
 * Human label for one endpoint: "11 · Stage Manager (HBP-2X)" with an
 * offline marker so you do not assign a button to a dead pack by accident.
 */
function endpointLabel(e) {
	const bits = []
	bits.push(`${e.id} · ${e.label || `Endpoint ${e.id}`}`)
	if (e.type) bits.push(`(${e.type})`)
	if (!e.online) bits.push('— offline')
	return bits.join(' ')
}

/**
 * Endpoint choices, online first then offline, each group by id.
 * @param {object} self instance
 * @param {{includeAll?: boolean, allLabel?: string}} [opts]
 */
export function endpointChoices(self, opts = {}) {
	const { includeAll = false, allLabel = 'ALL endpoints (system wide)' } = opts

	const eps = [...(self.state?.endpoints ?? [])].sort((a, b) => {
		if (a.online !== b.online) return a.online ? -1 : 1
		return Number(a.id) - Number(b.id)
	})

	const choices = eps.map((e) => ({ id: String(e.id), label: endpointLabel(e) }))

	if (!choices.length) {
		choices.push({
			id: '',
			label: '(no endpoints found yet — connect, or type an ID)',
		})
	}

	return includeAll ? [{ id: ENDPOINT_ALL, label: allLabel }, ...choices] : choices
}

/** Default endpoint id for a dropdown, so buttons are not born empty. */
export function firstEndpointId(self) {
	const eps = self.state?.endpoints ?? []
	const online = eps.find((e) => e.online)
	return String((online ?? eps[0])?.id ?? '')
}

/**
 * GPO choices. Uses whatever the base station reported; falls back to the
 * documented FSII Base II layout (4 GPOs) before the first poll lands.
 */
export function gpoChoices(self) {
	const ids = Object.keys(self.state?.gpo ?? {})
	const list = ids.length ? ids : ['1', '2', '3', '4']
	return list
		.map((id) => Number(id))
		.sort((a, b) => a - b)
		.map((id) => ({ id: String(id), label: `GPO ${id}` }))
}

/** GPI choices; FSII Base II has 2 GPIs. */
export function gpiChoices(self) {
	const ids = Object.keys(self.state?.gpi ?? {})
	const list = ids.length ? ids : ['1', '2']
	return list
		.map((id) => Number(id))
		.sort((a, b) => a - b)
		.map((id) => ({ id: String(id), label: `GPI ${id}` }))
}

/**
 * Interface choices from the polled interface list.
 * Label shows the type so "4W" vs "2W" is obvious when picking gain steps.
 */
export function interfaceChoices(self) {
	const ifaces = self.state?.interfaces ?? []
	const choices = ifaces.map((i) => ({
		id: String(i.id),
		label: `${i.id} · ${i.label || 'Interface'}${i.type ? ` (${i.type})` : ''}`,
	}))
	if (!choices.length) choices.push({ id: '1', label: '1 (type an ID if not listed)' })
	return choices
}

/**
 * Port choices as a flat "interfaceId:portId" list, because picking a port
 * without knowing its interface is meaningless. Actions split on ':'.
 */
export function portChoices(self) {
	const ifaces = self.state?.interfaces ?? []
	const choices = []
	for (const iface of ifaces) {
		for (const port of iface.ports ?? []) {
			choices.push({
				id: `${iface.id}:${port.id}`,
				label:
					`${iface.id}:${port.id} · ${port.label || `Port ${port.id}`}` +
					(iface.type ? ` [${iface.type}]` : ''),
			})
		}
	}
	if (!choices.length) {
		choices.push({ id: '1:1', label: '1:1 (connect to list real ports)' })
	}
	return choices
}

/**
 * Gain step choices for a port type, straight out of the CCM.
 * 2-wire runs +3..-3; everything else +12..-12 in 3 dB steps.
 */
export function gainChoices(type = '') {
	const t = String(type).toUpperCase()
	const steps = t === '2W' ? [3, 2, 1, 0, -1, -2, -3] : [12, 9, 6, 3, 0, -3, -6, -9, -12]
	return steps.map((v) => ({ id: String(v), label: `${v > 0 ? '+' : ''}${v} dB` }))
}

/**
 * A cheap signature of everything the dropdowns are built from. When this
 * changes, definitions need re-registering so the dropdowns refresh.
 */
export function choicesSignature(self) {
	const eps = (self.state?.endpoints ?? [])
		.map((e) => `${e.id}:${e.label}:${e.type}:${e.online ? 1 : 0}`)
		.join('|')
	const ifaces = (self.state?.interfaces ?? [])
		.map((i) => `${i.id}:${i.label}:${i.type}:${(i.ports ?? []).map((p) => p.id).join('.')}`)
		.join('|')
	const gpio = `${Object.keys(self.state?.gpo ?? {}).join('.')}/${Object.keys(self.state?.gpi ?? {}).join('.')}`
	return `${eps}#${ifaces}#${gpio}`
}
