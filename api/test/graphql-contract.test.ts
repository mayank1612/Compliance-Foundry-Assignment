/**
 * graphql-contract.test.ts — the API (Part 2) must stay a subset of the platform
 * design (Part 1), field for field.
 *
 * Why: clients built against today's Task Board API must keep working as the rest
 * of docs/part1/schema.graphql is implemented. Any type, field, argument or enum
 * value the API serves must exist in the design with the same type.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  buildSchema,
  isEnumType,
  isInputObjectType,
  isInterfaceType,
  isObjectType,
  type GraphQLNamedType,
  type GraphQLSchema,
} from 'graphql';
import { describe, expect, it } from 'vitest';
import { API_ROOT } from '../src/paths.js';

const load = async (path: string) => buildSchema(await readFile(path, 'utf8'));

/** Field name → printed type + printed argument types, for any type that has fields. */
type FieldShape = Map<string, { type: string; args: Map<string, string> }>;
function fieldsOf(type: GraphQLNamedType): FieldShape | null {
  if (isObjectType(type) || isInterfaceType(type)) {
    return new Map(
      Object.values(type.getFields()).map((field) => [
        field.name,
        {
          type: String(field.type),
          args: new Map(field.args.map((arg) => [arg.name, String(arg.type)])),
        },
      ]),
    );
  }
  if (isInputObjectType(type)) {
    return new Map(
      Object.values(type.getFields()).map((field) => [
        field.name,
        { type: String(field.type), args: new Map<string, string>() },
      ]),
    );
  }
  return null;
}

function contractViolations(api: GraphQLSchema, design: GraphQLSchema): string[] {
  const problems: string[] = [];
  for (const type of Object.values(api.getTypeMap())) {
    if (type.name.startsWith('__')) continue;
    const designed = design.getType(type.name);
    if (!designed) {
      problems.push(`${type.name}: not in the design`);
      continue;
    }
    if (isEnumType(type) && isEnumType(designed)) {
      for (const value of type.getValues()) {
        if (!designed.getValue(value.name))
          problems.push(`${type.name}.${value.name}: not in the design`);
      }
    }
    const apiFields = fieldsOf(type);
    const designedFields = fieldsOf(designed);
    if (apiFields && designedFields) {
      for (const [name, field] of apiFields) {
        const match = designedFields.get(name);
        if (!match) {
          problems.push(`${type.name}.${name}: not in the design`);
        } else if (match.type !== field.type) {
          problems.push(`${type.name}.${name}: ${field.type} vs design ${match.type}`);
        } else {
          for (const [argName, argType] of field.args) {
            if (match.args.get(argName) !== argType) {
              problems.push(`${type.name}.${name}(${argName}): differs from the design`);
            }
          }
        }
      }
    }
  }
  return problems;
}

describe('API ↔ design contract', () => {
  it('serves only types, fields, arguments and enum values that the design defines', async () => {
    const api = await load(resolve(API_ROOT, 'src', 'graphql', 'schema.graphql'));
    const design = await load(resolve(API_ROOT, '..', 'docs', 'part1', 'schema.graphql'));
    expect(contractViolations(api, design)).toEqual([]);
  });
});
