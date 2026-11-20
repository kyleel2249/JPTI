import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const appRoot = resolve(root, 'integrations/t-bots');
async function patch(relative, edits) {
  const file = resolve(appRoot, relative);
  let source = await readFile(file, 'utf8');
  for (const [before, after, label] of edits) {
    if (source.includes(after)) continue;
    if (!source.includes(before)) throw new Error('T-Bots upstream integration patch anchor missing: ' + label);
    source = source.replace(before, after);
  }
  await writeFile(file, source, 'utf8');
}

await patch('public/index.html', [[
  '            </select>\n          </div>\n          <p class="note">Execution is always paper trading.',
  '            </select>\n            <label for="jptiApiToken">JPTI shared-intelligence API token (optional)</label>\n            <input id="jptiApiToken" type="password" autocomplete="off" placeholder="Paste local JPTI_API_TOKEN">\n            <small id="jptiBridgeStatus" class="note">JPTI bridge not connected · paper execution only</small>\n          </div>\n          <p class="note">Execution is always paper trading.',
  'compose settings token input'
]]);
await patch('public/js/main.js', [
  ["import { LlmClient } from './services/llm-client.js';", "import { LlmClient } from './services/llm-client.js';\nimport { JptiBridge } from './services/jpti-bridge.js';", 'bridge import'],
  ["const llm = new LlmClient(env, pm);", "const llm = new LlmClient(env, pm);\nconst jptiBridge = new JptiBridge();", 'bridge instance'],
  ["let lastCfg = null;", "let lastCfg = null;\nlet sharedContext = null;", 'shared context state'],
  ["  orch = new Orchestrator({ config: cfg, feed, clock, seed });", "  jptiBridge.setToken($('jptiApiToken')?.value || '');\n  orch = new Orchestrator({ config: cfg, feed, clock, seed });", 'token handoff'],
  ["  await orch.init();\n  orch.bus.on('session:end', onEnd);", "  await orch.init();\n  if (jptiBridge.enabled) {\n    jptiBridge.attach(orch, runId);\n    await jptiBridge.loadMemory();\n    sharedContext = mode === 'live' ? await jptiBridge.refreshContext(true) : null;\n    orch.setSharedContext(sharedContext);\n    $('jptiBridgeStatus').textContent = sharedContext ? 'JPTI linked · ' + sharedContext.regime + ' · paper gate active' : 'JPTI linked · context unavailable';\n  } else { sharedContext = null; orch.setSharedContext(null); }\n  orch.bus.on('session:end', onEnd);", 'bridge session attach'],
  ["        if (mode === 'live') {\n          await orch.step();", "        if (mode === 'live') {\n          if (jptiBridge.enabled) orch.setSharedContext(await jptiBridge.refreshContext());\n          await orch.step();", 'live context refresh'],
  ["  $('viewCompose').hidden = false;\n  $('subtitle').textContent = 'new session · overnight trading prompt';", "  $('viewCompose').hidden = false;\n  $('jptiBridgeStatus').textContent = 'JPTI bridge not connected';\n  $('subtitle').textContent = 'new session · overnight trading prompt';", 'bridge reset']
]);
await patch('public/js/core/orchestrator.js', [
  ["    this.banner = 'ready';", "    this.banner = 'ready';\n    this.sharedContext = null;", 'context state'],
  ["    this.ledger.step(task, 'RUG CHECK', 'pass');\n    if (this.paused) return this.ledger.step(task, 'ORCHESTRATOR', 'waiting', 'entries paused');",
   "    this.ledger.step(task, 'RUG CHECK', 'pass');\n    if (this.sharedContext?.regime === 'risk_off' && Number(this.sharedContext.riskScore) < 35) {\n      this.ledger.done(task, 'skipped', 'JPTI shared market regime is risk-off');\n      this._filtered(token, 'JPTI shared risk gate: BTC market regime risk-off; new Solana entries blocked. Existing exits remain active.', 'jpti-risk-off');\n      return;\n    }\n    if (this.paused) return this.ledger.step(task, 'ORCHESTRATOR', 'waiting', 'entries paused');",
   'risk-off gate'],
  ["  snapshot() {\n    const eq = this.equity;", "  setSharedContext(context) { this.sharedContext = context && Date.now() - Date.parse(context.fetchedAt) <= 120000 ? context : null; }\n\n  snapshot() {\n    const eq = this.equity;", 'context setter'],
  ["      pauseReason: this.pauseReason,", "      pauseReason: this.pauseReason,\n      sharedContext: this.sharedContext ? { regime: this.sharedContext.regime, riskScore: this.sharedContext.riskScore, fetchedAt: this.sharedContext.fetchedAt } : null,", 'context snapshot']
]);
await copyFile(resolve(root, 'integrations/t-bots-adapter/jpti-bridge.js'), resolve(appRoot, 'public/js/services/jpti-bridge.js'));
console.log('T-Bots JPTI adapter patches applied.');
