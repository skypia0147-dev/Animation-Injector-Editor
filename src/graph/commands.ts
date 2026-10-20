import type {Workspace} from '../workspace.ts';
import type {GraphEdge} from './projection.ts';
import {addFlat, addDetachedCondition, connectFlat, deleteFlat} from './flat.ts';
import {addConnected, type AddOption} from './contextAdd.ts';
import {disconnectEdge} from './disconnect.ts';
import {deleteChecklistNode} from './checklist.ts';

export type GraphCommand =
  | {type: 'add'; owner: string; kind: string; position: {x: number; y: number}}
  | {type: 'addConnected'; source: string; option: AddOption; position: {x: number; y: number}}
  | {type: 'connect'; source: string; target: string; port?: string}
  | {type: 'disconnect'; edge: GraphEdge}
  | {type: 'delete'; id: string};

// One invocation is one document edit. View-only grouping and focus stay outside.
export function executeGraphCommand(w: Workspace, command: GraphCommand): {workspace: Workspace; id?: string} {
  switch (command.type) {
    case 'add':
      return command.kind === 'conditionBranch'
        ? addDetachedCondition(w, command.owner, command.position)
        : addFlat(w, command.owner, command.kind, command.position);
    case 'addConnected':
      return addConnected(w, command.source, command.option, command.position);
    case 'connect':
      return {workspace: connectFlat(w, command.source, command.target, command.port)};
    case 'disconnect':
      return {workspace: disconnectEdge(w, command.edge)};
    case 'delete':
      return {workspace: deleteChecklistNode(w, command.id)};
  }
}
