/** 시작 제한 (runtime 0.12.276, docs/mockup-start-limits): an action's <Require> holds its own nature only, where it
 *  may start (air) and its cooldown. A state check (weapon drawn, attacking, stamina) is a condition branch's test, so
 *  an older project or file moves them, the way tools/require_to_flow.py does in the runtime repository:
 *  - into the front of the action's own flow;
 *  - for an action another flow picks, into that flow just before it, unless that flow's owner checks the same at its
 *    front (it guards every route of its flow);
 *  - otherwise, for an action that starts by itself (a key or an event), into a flow of its own that plays itself;
 *  - an action reached only by transitions keeps no check (the action before it checked), nor does one a transition
 *    with its own blend reaches (the runtime takes no flow there).
 *  Runs on the raw parsed JSON (an older project) or on an imported workspace, before validation. */
type Check = {id: string; test: Record<string, unknown>};

function checksOf(p: any): Check[] {
  if (!p || typeof p !== 'object') return [];
  const out: Check[] = [];
  if (p.weapon === true) out.push({id: 'RequireWeapon', test: {kind: 'weaponDrawn'}});
  if (p.blockWhileAttacking === true)
    out.push({id: 'RequireNotAttacking', test: {kind: 'attackState', attackState: 'none'}});
  const stamina = Number(p.requiredStamina);
  if (Number.isFinite(stamina) && stamina > 0)
    out.push({id: 'RequireStamina', test: {kind: 'stamina', minimum: stamina}});
  return out;
}
const dropFields = (p: any) => {
  if (!p || typeof p !== 'object') return;
  delete p.weapon;
  delete p.blockWhileAttacking;
  delete p.requiredStamina;
};
const unique = (base: string, used: Set<string>) => {
  let id = base,
    i = 2;
  while (used.has(id)) id = base + i++;
  used.add(id);
  return id;
};
/** The tests of `checks` chained in order, the last passing to `then`. */
function chain(checks: Check[], used: Set<string>, then: {node: string} | {action: string}) {
  const ids = checks.map(c => unique(c.id, used));
  return {
    first: ids[0],
    tests: checks.map((c, i) => ({
      id: ids[i],
      subject: 'self',
      minimum: 0,
      ...c.test,
      pass: i + 1 < ids.length ? {node: ids[i + 1]} : then,
    })),
  };
}
const target = (e: any) => (e && typeof e === 'object' && typeof e.action === 'string' ? e.action : undefined);

/** A single-action project (schema 1-2) has no flows yet: its state checks are taken out before it is parsed and
 *  put back on the action it becomes, for liftStartLimits. */
export function takeStartChecks(p: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!p || typeof p !== 'object') return out;
  for (const k of ['weapon', 'blockWhileAttacking', 'requiredStamina']) if (k in p) out[k] = p[k];
  dropFields(p);
  return out;
}
export function liftStartLimits(w: any) {
  const actions: any[] = Array.isArray(w?.actions) ? w.actions : [];
  const checks = new Map<string, Check[]>();
  for (const a of actions) {
    const found = checksOf(a?.config);
    if (found.length && typeof a.uid === 'string') checks.set(a.uid, found);
    dropFields(a?.config);
    for (const v of Object.values(a?.variants ?? {}) as any[]) dropFields(v?.config);
  }
  for (const d of Array.isArray(w?.drafts) ? w.drafts : []) dropFields(d?.value?.config);
  if (!checks.size) return w;
  const owners = new Map<string, any[]>();
  for (const a of actions)
    for (const t of a?.flow?.tests ?? [])
      for (const e of [t?.pass, t?.fail]) {
        const to = target(e);
        if (to && to !== a.uid && !(owners.get(to) ?? []).includes(a)) owners.set(to, [...(owners.get(to) ?? []), a]);
      }
  // A transition with its own blend cannot reach an action with a flow (runtime).
  const blended = new Set<string>(
    (Array.isArray(w?.links) ? w.links : []).filter((l: any) => l?.blend != null).map((l: any) => l.to)
  );
  for (const a of actions) {
    const own = checks.get(a.uid);
    if (!own) continue;
    if (a.flow && Array.isArray(a.flow.tests)) {
      const used = new Set<string>(a.flow.tests.map((t: any) => t.id));
      const c = chain(own, used, {node: a.flow.entry});
      a.flow.tests = [...c.tests, ...a.flow.tests];
      a.flow.entry = c.first;
    } else if (owners.has(a.uid)) {
      for (const owner of owners.get(a.uid)!) {
        // The owner's own front checks guard every route of its flow.
        const front = (checks.get(owner.uid) ?? []).map(c => c.id);
        if (own.every(c => front.includes(c.id))) continue;
        const used = new Set<string>(owner.flow.tests.map((t: any) => t.id));
        const c = chain(own, used, {action: a.uid});
        for (const t of owner.flow.tests)
          for (const key of ['pass', 'fail'] as const) if (target(t[key]) === a.uid) t[key] = {node: c.first};
        owner.flow.tests.push(...c.tests);
      }
    } else if (a.config?.start?.mode !== 'none' && !blended.has(a.uid)) {
      const c = chain(own, new Set(), {action: a.uid});
      a.flow = {entry: c.first, tests: c.tests};
    }
  }
  return w;
}
