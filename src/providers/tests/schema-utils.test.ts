import { describe, expect, it } from 'vitest';
import { cleanSchema, normalizeToolSchema } from '../schema-utils.js';

describe('Schema Utils', () => {
  // ===========================================================================
  // cleanSchema
  // ===========================================================================

  describe('cleanSchema', () => {
    it('returns primitive types unchanged', () => {
      expect(cleanSchema(null)).toBeNull();
      expect(cleanSchema(undefined)).toBeUndefined();
      expect(cleanSchema('string')).toBe('string');
      expect(cleanSchema(42)).toBe(42);
    });

    it('strips unsupported keywords', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[a-z]+$' },
        },
        additionalProperties: false,
        $schema: 'http://json-schema.org/draft-07/schema#',
        $id: 'test',
      };

      const cleaned = cleanSchema(schema) as Record<string, unknown>;
      expect(cleaned).not.toHaveProperty('$schema');
      expect(cleaned).not.toHaveProperty('$id');
      expect(cleaned).not.toHaveProperty('additionalProperties');
    });

    it('resolves $ref to definitions', () => {
      const schema = {
        type: 'object',
        $defs: {
          Name: { type: 'string', description: 'A name' },
        },
        properties: {
          name: { $ref: '#/$defs/Name' },
        },
      };

      const cleaned = cleanSchema(schema) as Record<string, unknown>;
      const props = cleaned.properties as Record<string, unknown>;
      const name = props.name as Record<string, unknown>;
      expect(name.type).toBe('string');
      expect(name.description).toBe('A name');
    });

    it('handles anyOf with null variant (optional field)', () => {
      const schema = {
        type: 'object',
        properties: {
          value: {
            anyOf: [
              { type: 'string' },
              { type: 'null' },
            ],
          },
        },
      };

      const cleaned = cleanSchema(schema) as Record<string, unknown>;
      const props = cleaned.properties as Record<string, unknown>;
      const value = props.value as Record<string, unknown>;
      // Should strip null variant and return just the string type
      expect(value.type).toBe('string');
    });

    it('flattens literal anyOf to enum', () => {
      const schema = {
        type: 'object',
        properties: {
          status: {
            anyOf: [
              { type: 'string', const: 'active' },
              { type: 'string', const: 'inactive' },
              { type: 'string', const: 'pending' },
            ],
          },
        },
      };

      const cleaned = cleanSchema(schema) as Record<string, unknown>;
      const props = cleaned.properties as Record<string, unknown>;
      const status = props.status as Record<string, unknown>;
      expect(status.type).toBe('string');
      expect(status.enum).toEqual(['active', 'inactive', 'pending']);
    });

    it('handles circular $ref gracefully', () => {
      const schema = {
        type: 'object',
        $defs: {
          Tree: {
            type: 'object',
            properties: {
              children: {
                type: 'array',
                items: { $ref: '#/$defs/Tree' },
              },
            },
          },
        },
        properties: {
          root: { $ref: '#/$defs/Tree' },
        },
      };

      // Should not throw or infinite loop
      const cleaned = cleanSchema(schema);
      expect(cleaned).toBeDefined();
    });

    it('strips default keyword', () => {
      const schema = {
        type: 'string',
        default: 'hello',
      };

      const cleaned = cleanSchema(schema) as Record<string, unknown>;
      expect(cleaned).not.toHaveProperty('default');
    });
  });

  // ===========================================================================
  // normalizeToolSchema
  // ===========================================================================

  describe('normalizeToolSchema', () => {
    it('returns default object schema for null/undefined', () => {
      const result = normalizeToolSchema(null);
      expect(result.type).toBe('object');
      expect(result.properties).toBeDefined();
    });

    it('ensures top-level type: "object"', () => {
      const schema = {
        properties: {
          name: { type: 'string' },
        },
      };

      const result = normalizeToolSchema(schema);
      expect(result.type).toBe('object');
      expect(result.properties).toBeDefined();
    });

    it('preserves properties and required fields', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The name' },
          age: { type: 'number' },
        },
        required: ['name'],
      };

      const result = normalizeToolSchema(schema);
      expect(result.type).toBe('object');
      expect(result.required).toEqual(['name']);
      const props = result.properties as Record<string, unknown>;
      expect(props.name).toBeDefined();
      expect(props.age).toBeDefined();
    });

    it('cleans nested schemas', () => {
      const schema = {
        type: 'object',
        properties: {
          config: {
            type: 'object',
            properties: {
              value: { type: 'string', minLength: 1 },
            },
            additionalProperties: false,
          },
        },
      };

      const result = normalizeToolSchema(schema);
      const props = result.properties as Record<string, Record<string, unknown>>;
      const config = props.config;
      expect(config).not.toHaveProperty('additionalProperties');
    });

    it('handles empty schema', () => {
      const result = normalizeToolSchema({});
      expect(result.type).toBe('object');
      expect(result.properties).toBeDefined();
    });

    it('normalizes schema with array type including null', () => {
      const schema = {
        type: 'object',
        properties: {
          value: { type: ['string', 'null'] },
        },
      };

      const result = normalizeToolSchema(schema);
      const props = result.properties as Record<string, Record<string, unknown>>;
      // null should be stripped from the array type, leaving a single string
      expect(props.value?.type).toBe('string');
    });

    it('flattens anyOf union variants into merged properties', () => {
      const schema = {
        anyOf: [
          {
            type: 'object',
            properties: { name: { type: 'string' } },
            required: ['name'],
          },
          {
            type: 'object',
            properties: { age: { type: 'number' } },
            required: ['age'],
          },
        ],
      };

      const result = normalizeToolSchema(schema);
      expect(result.type).toBe('object');
      const props = result.properties as Record<string, unknown>;
      expect(props.name).toBeDefined();
      expect(props.age).toBeDefined();
    });

    it('flattens oneOf union variants into merged properties', () => {
      const schema = {
        oneOf: [
          {
            type: 'object',
            properties: { x: { type: 'number' } },
            required: ['x'],
          },
          {
            type: 'object',
            properties: { y: { type: 'number' } },
            required: ['y'],
          },
        ],
      };

      const result = normalizeToolSchema(schema);
      expect(result.type).toBe('object');
      const props = result.properties as Record<string, unknown>;
      expect(props.x).toBeDefined();
      expect(props.y).toBeDefined();
    });

    it('infers required from fields shared across all union variants', () => {
      const schema = {
        anyOf: [
          {
            type: 'object',
            properties: { id: { type: 'string' }, extra: { type: 'string' } },
            required: ['id'],
          },
          {
            type: 'object',
            properties: { id: { type: 'string' } },
            required: ['id'],
          },
        ],
      };

      const result = normalizeToolSchema(schema);
      expect(result.required).toContain('id');
    });

    it('infers type: object for nested property without explicit type', () => {
      const schema = {
        type: 'object',
        properties: {
          config: {
            properties: {
              debug: { type: 'boolean' },
            },
          },
        },
      };

      const result = normalizeToolSchema(schema);
      const props = result.properties as Record<string, Record<string, unknown>>;
      expect(props.config?.type).toBe('object');
    });

    it('infers type: array for property with items', () => {
      const schema = {
        type: 'object',
        properties: {
          tags: {
            items: { type: 'string' },
          },
        },
      };

      const result = normalizeToolSchema(schema);
      const props = result.properties as Record<string, Record<string, unknown>>;
      expect(props.tags?.type).toBe('array');
    });

    it('infers type from enum values for property with no type', () => {
      const schema = {
        type: 'object',
        properties: {
          color: { enum: ['red', 'blue', 'green'] },
        },
      };

      const result = normalizeToolSchema(schema);
      const props = result.properties as Record<string, Record<string, unknown>>;
      expect(props.color?.type).toBe('string');
    });
  });

  // ===========================================================================
  // cleanSchema - advanced cases
  // ===========================================================================

  describe('cleanSchema - advanced cases', () => {
    it('strips constraint keywords: minLength, maxLength, pattern', () => {
      const schema = {
        type: 'string',
        minLength: 1,
        maxLength: 255,
        pattern: '^[a-z]+$',
      };

      const cleaned = cleanSchema(schema) as Record<string, unknown>;
      expect(cleaned).not.toHaveProperty('minLength');
      expect(cleaned).not.toHaveProperty('maxLength');
      expect(cleaned).not.toHaveProperty('pattern');
      expect(cleaned.type).toBe('string');
    });

    it('strips numeric constraint keywords: minimum, maximum, multipleOf', () => {
      const schema = {
        type: 'number',
        minimum: 0,
        maximum: 100,
        multipleOf: 5,
      };

      const cleaned = cleanSchema(schema) as Record<string, unknown>;
      expect(cleaned).not.toHaveProperty('minimum');
      expect(cleaned).not.toHaveProperty('maximum');
      expect(cleaned).not.toHaveProperty('multipleOf');
    });

    it('strips array constraint keywords: minItems, maxItems, uniqueItems', () => {
      const schema = {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 10,
        uniqueItems: true,
      };

      const cleaned = cleanSchema(schema) as Record<string, unknown>;
      expect(cleaned).not.toHaveProperty('minItems');
      expect(cleaned).not.toHaveProperty('maxItems');
      expect(cleaned).not.toHaveProperty('uniqueItems');
    });

    it('strips logic keywords: not, if, then, else', () => {
      const schema = {
        type: 'object',
        properties: { value: { type: 'string' } },
        if: { properties: { value: { const: 'special' } } },
        then: { required: ['extra'] },
        else: { required: [] },
        not: {},
      };

      const cleaned = cleanSchema(schema) as Record<string, unknown>;
      expect(cleaned).not.toHaveProperty('if');
      expect(cleaned).not.toHaveProperty('then');
      expect(cleaned).not.toHaveProperty('else');
      expect(cleaned).not.toHaveProperty('not');
    });

    it('converts const to enum', () => {
      const schema = {
        type: 'string',
        const: 'fixed-value',
      };

      const cleaned = cleanSchema(schema) as Record<string, unknown>;
      expect(cleaned).not.toHaveProperty('const');
      expect(cleaned.enum).toEqual(['fixed-value']);
    });

    it('resolves $ref from legacy definitions block', () => {
      const schema = {
        type: 'object',
        definitions: {
          Address: { type: 'string', description: 'A mailing address' },
        },
        properties: {
          home: { $ref: '#/definitions/Address' },
        },
      };

      const cleaned = cleanSchema(schema) as Record<string, unknown>;
      const props = cleaned.properties as Record<string, unknown>;
      const home = props.home as Record<string, unknown>;
      expect(home.type).toBe('string');
      expect(home.description).toBe('A mailing address');
    });

    it('handles array type with only null - collapses gracefully', () => {
      const schema = {
        type: ['null'],
      };

      // After stripping null, type array is empty - should produce an empty string or original
      const cleaned = cleanSchema(schema) as Record<string, unknown>;
      expect(cleaned).toBeDefined();
    });

    it('passes description and title through $ref resolution', () => {
      const schema = {
        type: 'object',
        $defs: {
          Item: { type: 'string' },
        },
        properties: {
          label: { $ref: '#/$defs/Item', description: 'Override description' },
        },
      };

      const cleaned = cleanSchema(schema) as Record<string, unknown>;
      const props = cleaned.properties as Record<string, unknown>;
      const label = props.label as Record<string, unknown>;
      expect(label.description).toBe('Override description');
    });

    it('strips format keyword from string schemas', () => {
      const schema = {
        type: 'string',
        format: 'date-time',
      };

      const cleaned = cleanSchema(schema) as Record<string, unknown>;
      expect(cleaned).not.toHaveProperty('format');
    });

    it('processes allOf arrays recursively', () => {
      const schema = {
        allOf: [
          { type: 'object', properties: { a: { type: 'string', minLength: 1 } } },
        ],
      };

      const cleaned = cleanSchema(schema) as Record<string, unknown>;
      const allOf = cleaned.allOf as Array<Record<string, unknown>>;
      const firstEntry = allOf[0] as Record<string, unknown>;
      const aProps = (firstEntry.properties as Record<string, Record<string, unknown>>).a;
      expect(aProps).not.toHaveProperty('minLength');
    });

    it('strips examples keyword', () => {
      const schema = {
        type: 'string',
        examples: ['hello', 'world'],
      };

      const cleaned = cleanSchema(schema) as Record<string, unknown>;
      expect(cleaned).not.toHaveProperty('examples');
    });

    it('handles oneOf with null variant - strips null and returns lone variant', () => {
      const schema = {
        type: 'object',
        properties: {
          label: {
            oneOf: [
              { type: 'string' },
              { type: 'null' },
            ],
          },
        },
      };

      const cleaned = cleanSchema(schema) as Record<string, unknown>;
      const props = cleaned.properties as Record<string, unknown>;
      const label = props.label as Record<string, unknown>;
      expect(label.type).toBe('string');
    });

    it('handles items as array (tuple schema)', () => {
      const schema = {
        type: 'array',
        items: [
          { type: 'string', minLength: 1 },
          { type: 'number', minimum: 0 },
        ],
      };

      const cleaned = cleanSchema(schema) as Record<string, unknown>;
      const items = cleaned.items as Array<Record<string, unknown>>;
      expect(items[0]).not.toHaveProperty('minLength');
      expect(items[1]).not.toHaveProperty('minimum');
    });
  });
});
