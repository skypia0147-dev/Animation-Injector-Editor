import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspace, addAction} from '../src/workspace.ts';
import {captureGraph, lowerGraph, authorReducer} from '../src/graph/document.ts';
import {renderedFlatGraph, renderedChecklist, renderedRegistry, renderedLibrary} from '../src/graph/renderCache.ts';
import {flatGraph} from '../src/graph/flat.ts';
import {checklistModel} from '../src/graph/checklist.ts';
import {setLanguage, getLanguage} from '../src/i18n/index.ts';

// Editor performance (docs/수정-성능-2026-09-30.md): views of the rendered document are computed once per
// document object, and the rendered document shares the history's records (capture and lower do not copy).
const sample = () => {
  const w = emptyWorkspace();
  w.actions.push(addAction(w, 'single'));
  w.actions.push(addAction(w, 'pair'));
  return w;
};

test('render views: once per document object and language, equal to computing them directly', () => {
  const w = sample();
  const graph = renderedFlatGraph(w);
  assert.equal(renderedFlatGraph(w), graph, 'the same object for the same document');
  assert.deepEqual(graph, flatGraph(w));
  const model = renderedChecklist(w);
  assert.equal(model.raw, graph, 'the card model reuses the flat graph');
  assert.deepEqual(JSON.stringify([...model.items]), JSON.stringify([...checklistModel(w).items]));
  assert.equal(renderedRegistry(w), renderedRegistry(w));
  assert.equal(renderedLibrary(w), renderedLibrary(w));
  // Another document object is computed again, keeping the parts equal to the latest view as those objects:
  // an equal document shares the whole view, a renamed action changes its own card's items only.
  assert.equal(renderedFlatGraph(structuredClone(w)), graph);
  const renamed = structuredClone(w);
  renamed.actions[0].config.name = 'Renamed';
  const renamedModel = renderedChecklist(renamed);
  assert.deepEqual(JSON.stringify([...renamedModel.items]), JSON.stringify([...checklistModel(renamed).items]));
  const ownCards = new Set(renamedModel.raw.nodes.filter(n => n.action === w.actions[0].uid).map(n => n.id));
  for (const [id, items] of renamedModel.items)
    if (!ownCards.has(id) && model.items.has(id)) assert.equal(items, model.items.get(id), id);
  // Another language is another view (translated titles).
  const before = getLanguage();
  setLanguage(before === 'ko' ? 'en' : 'ko');
  try {
    assert.notEqual(renderedFlatGraph(w), graph);
  } finally {
    setLanguage(before);
  }
  assert.equal(renderedFlatGraph(w), graph);
});

test("capture and lower share records: the next present's document shares what the edit left alone", () => {
  const w = sample();
  const first = captureGraph(w);
  // No copies: the graph holds the document's records, and lowering it gives them back.
  assert.equal(first.nodes.find(n => n.kind === 'play').data, w.actions[0].config.steps[0]);
  assert.equal(first.meta.qtes, w.qtes);
  const before = lowerGraph(first);
  assert.equal(before.actions[0].config.steps[0], w.actions[0].config.steps[0]);
  assert.deepEqual(before, lowerGraph(captureGraph(structuredClone(w))));
  let history = {present: first, past: [], future: []};
  const next = structuredClone(w);
  next.actions[0].config.name = 'Renamed';
  history = authorReducer(history, {type: 'edit', next, graph: captureGraph(next)});
  const after = lowerGraph(history.present);
  assert.equal(after.actions[0].config.name, 'Renamed');
  // The history shared the unchanged step, so the new document holds the previous document's record.
  assert.equal(after.actions[0].config.steps[0], before.actions[0].config.steps[0]);
  assert.equal(after.qtes, before.qtes);
  // Nothing changed in place.
  assert.equal(w.actions[0].config.name, sample().actions[0].config.name);
});
