/**
 * Schema Utilities for AI Tool Calling
 *
 * Normalizes JSON Schema for compatibility with different AI providers.
 * Based on OpenClaw's battle-tested schema normalization.
 *
 * Key requirements:
 * - OpenAI/Azure: Top-level must be `type: "object"`
 * - Gemini: Rejects $ref, definitions, additionalProperties, etc.
 * - All: Avoid complex anyOf/oneOf unions at top level
 */

// Keywords that cloud providers often reject
const UNSUPPORTED_SCHEMA_KEYWORDS = new Set([
  'patternProperties',
  'additionalProperties',
  '$schema',
  '$id',
  '$ref',
  '$defs',
  'definitions',
  'examples',
  // Logical composition keywords that can cause issues
  'not', // Azure interprets { not: {} } as type: "None"
  'if',
  'then',
  'else',
  // Default values not supported in tool schemas
  'default',
  // Constraint keywords that can cause issues
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'multipleOf',
  'pattern',
  'format',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minProperties',
  'maxProperties',
]);

type SchemaDefs = Map<string, unknown>;

/**
 * Extract enum values from a schema (handles const, enum, anyOf/oneOf of literals)
 */
function extractEnumValues(schema: unknown): unknown[] | undefined {
  if (!schema || typeof schema !== 'object') {
    return undefined;
  }
  const record = schema as Record<string, unknown>;
  if (Array.isArray(record.enum)) {
    return record.enum;
  }
  if ('const' in record) {
    return [record.const];
  }
  const variants = Array.isArray(record.anyOf)
    ? record.anyOf
    : Array.isArray(record.oneOf)
      ? record.oneOf
      : null;
  if (variants) {
    const values = variants.flatMap((variant) => {
      const extracted = extractEnumValues(variant);
      return extracted ?? [];
    });
    return values.length > 0 ? values : undefined;
  }
  return undefined;
}

/**
 * Merge two property schemas, combining enums where possible
 */
function mergePropertySchemas(existing: unknown, incoming: unknown): unknown {
  if (!existing) return incoming;
  if (!incoming) return existing;

  const existingEnum = extractEnumValues(existing);
  const incomingEnum = extractEnumValues(incoming);
  if (existingEnum || incomingEnum) {
    const values = Array.from(new Set([...(existingEnum ?? []), ...(incomingEnum ?? [])]));
    const merged: Record<string, unknown> = {};
    for (const source of [existing, incoming]) {
      if (!source || typeof source !== 'object') continue;
      const record = source as Record<string, unknown>;
      for (const key of ['title', 'description', 'default']) {
        if (!(key in merged) && key in record) {
          merged[key] = record[key];
        }
      }
    }
    const types = new Set(values.map((value) => typeof value));
    if (types.size === 1) {
      merged.type = Array.from(types)[0];
    }
    merged.enum = values;
    return merged;
  }
  return existing;
}

/**
 * Try to flatten an anyOf/oneOf array of literals into a simple enum
 */
function tryFlattenLiteralAnyOf(variants: unknown[]): { type: string; enum: unknown[] } | null {
  if (variants.length === 0) return null;

  const allValues: unknown[] = [];
  let commonType: string | null = null;

  for (const variant of variants) {
    if (!variant || typeof variant !== 'object') return null;
    const v = variant as Record<string, unknown>;

    let literalValue: unknown;
    if ('const' in v) {
      literalValue = v.const;
    } else if (Array.isArray(v.enum) && v.enum.length === 1) {
      literalValue = v.enum[0];
    } else {
      return null;
    }

    const variantType = typeof v.type === 'string' ? v.type : null;
    if (!variantType) return null;
    if (commonType === null) {
      commonType = variantType;
    } else if (commonType !== variantType) {
      return null;
    }
    allValues.push(literalValue);
  }

  if (commonType && allValues.length > 0) {
    return { type: commonType, enum: allValues };
  }
  return null;
}

/**
 * Check if a schema variant represents null
 */
function isNullSchema(variant: unknown): boolean {
  if (!variant || typeof variant !== 'object' || Array.isArray(variant)) return false;
  const record = variant as Record<string, unknown>;
  if ('const' in record && record.const === null) return true;
  if (Array.isArray(record.enum) && record.enum.length === 1 && record.enum[0] === null) return true;
  const typeValue = record.type;
  if (typeValue === 'null') return true;
  if (Array.isArray(typeValue) && typeValue.length === 1 && typeValue[0] === 'null') return true;
  return false;
}

/**
 * Strip null variants from an array
 */
function stripNullVariants(variants: unknown[]): { variants: unknown[]; stripped: boolean } {
  if (variants.length === 0) return { variants, stripped: false };
  const nonNull = variants.filter((variant) => !isNullSchema(variant));
  return { variants: nonNull, stripped: nonNull.length !== variants.length };
}

/**
 * Extend schema definitions from $defs or definitions
 */
function extendSchemaDefs(defs: SchemaDefs | undefined, schema: Record<string, unknown>): SchemaDefs | undefined {
  const defsEntry = schema.$defs && typeof schema.$defs === 'object' && !Array.isArray(schema.$defs)
    ? (schema.$defs as Record<string, unknown>)
    : undefined;
  const legacyDefsEntry = schema.definitions && typeof schema.definitions === 'object' && !Array.isArray(schema.definitions)
    ? (schema.definitions as Record<string, unknown>)
    : undefined;

  if (!defsEntry && !legacyDefsEntry) return defs;

  const next = defs ? new Map(defs) : new Map<string, unknown>();
  if (defsEntry) {
    for (const [key, value] of Object.entries(defsEntry)) {
      next.set(key, value);
    }
  }
  if (legacyDefsEntry) {
    for (const [key, value] of Object.entries(legacyDefsEntry)) {
      next.set(key, value);
    }
  }
  return next;
}

/**
 * Decode JSON pointer segment
 */
function decodeJsonPointerSegment(segment: string): string {
  return segment.replaceAll('~1', '/').replaceAll('~0', '~');
}

/**
 * Try to resolve a local $ref
 */
function tryResolveLocalRef(ref: string, defs: SchemaDefs | undefined): unknown {
  if (!defs) return undefined;
  const match = ref.match(/^#\/(?:\$defs|definitions)\/(.+)$/);
  if (!match) return undefined;
  const name = decodeJsonPointerSegment(match[1] ?? '');
  if (!name) return undefined;
  return defs.get(name);
}

/**
 * Clean schema recursively with definitions context
 */
function cleanSchemaWithDefs(
  schema: unknown,
  defs: SchemaDefs | undefined,
  refStack: Set<string> | undefined,
): unknown {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) {
    return schema.map((item) => cleanSchemaWithDefs(item, defs, refStack));
  }

  const obj = schema as Record<string, unknown>;
  const nextDefs = extendSchemaDefs(defs, obj);

  // Handle $ref
  const refValue = typeof obj.$ref === 'string' ? obj.$ref : undefined;
  if (refValue) {
    if (refStack?.has(refValue)) return {};
    const resolved = tryResolveLocalRef(refValue, nextDefs);
    if (resolved) {
      const nextRefStack = refStack ? new Set(refStack) : new Set<string>();
      nextRefStack.add(refValue);
      const cleaned = cleanSchemaWithDefs(resolved, nextDefs, nextRefStack);
      if (!cleaned || typeof cleaned !== 'object' || Array.isArray(cleaned)) return cleaned;
      const result: Record<string, unknown> = { ...(cleaned as Record<string, unknown>) };
      for (const key of ['description', 'title', 'default']) {
        if (key in obj && obj[key] !== undefined) result[key] = obj[key];
      }
      return result;
    }
    // Unresolved ref - return metadata only
    const result: Record<string, unknown> = {};
    for (const key of ['description', 'title', 'default']) {
      if (key in obj && obj[key] !== undefined) result[key] = obj[key];
    }
    return result;
  }

  // Handle anyOf/oneOf
  const hasAnyOf = 'anyOf' in obj && Array.isArray(obj.anyOf);
  const hasOneOf = 'oneOf' in obj && Array.isArray(obj.oneOf);

  let cleanedAnyOf = hasAnyOf
    ? (obj.anyOf as unknown[]).map((variant) => cleanSchemaWithDefs(variant, nextDefs, refStack))
    : undefined;
  let cleanedOneOf = hasOneOf
    ? (obj.oneOf as unknown[]).map((variant) => cleanSchemaWithDefs(variant, nextDefs, refStack))
    : undefined;

  // Process anyOf
  if (hasAnyOf && cleanedAnyOf) {
    const { variants: nonNullVariants, stripped } = stripNullVariants(cleanedAnyOf);
    if (stripped) cleanedAnyOf = nonNullVariants;

    const flattened = tryFlattenLiteralAnyOf(nonNullVariants);
    if (flattened) {
      const result: Record<string, unknown> = { type: flattened.type, enum: flattened.enum };
      for (const key of ['description', 'title', 'default']) {
        if (key in obj && obj[key] !== undefined) result[key] = obj[key];
      }
      return result;
    }
    if (stripped && nonNullVariants.length === 1) {
      const lone = nonNullVariants[0];
      if (lone && typeof lone === 'object' && !Array.isArray(lone)) {
        const result: Record<string, unknown> = { ...(lone as Record<string, unknown>) };
        for (const key of ['description', 'title', 'default']) {
          if (key in obj && obj[key] !== undefined) result[key] = obj[key];
        }
        return result;
      }
      return lone;
    }
  }

  // Process oneOf
  if (hasOneOf && cleanedOneOf) {
    const { variants: nonNullVariants, stripped } = stripNullVariants(cleanedOneOf);
    if (stripped) cleanedOneOf = nonNullVariants;

    const flattened = tryFlattenLiteralAnyOf(nonNullVariants);
    if (flattened) {
      const result: Record<string, unknown> = { type: flattened.type, enum: flattened.enum };
      for (const key of ['description', 'title', 'default']) {
        if (key in obj && obj[key] !== undefined) result[key] = obj[key];
      }
      return result;
    }
    if (stripped && nonNullVariants.length === 1) {
      const lone = nonNullVariants[0];
      if (lone && typeof lone === 'object' && !Array.isArray(lone)) {
        const result: Record<string, unknown> = { ...(lone as Record<string, unknown>) };
        for (const key of ['description', 'title', 'default']) {
          if (key in obj && obj[key] !== undefined) result[key] = obj[key];
        }
        return result;
      }
      return lone;
    }
  }

  // Build cleaned schema
  const cleaned: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    // Skip unsupported keywords
    if (UNSUPPORTED_SCHEMA_KEYWORDS.has(key)) continue;

    // Convert const to enum
    if (key === 'const') {
      cleaned.enum = [value];
      continue;
    }

    // Skip type when anyOf/oneOf present
    if (key === 'type' && (hasAnyOf || hasOneOf)) continue;

    // Handle array types like ["string", "null"]
    if (key === 'type' && Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
      const types = value.filter((entry) => entry !== 'null');
      cleaned.type = types.length === 1 ? types[0] : types;
      continue;
    }

    // Recursively clean properties
    if (key === 'properties' && value && typeof value === 'object') {
      const props = value as Record<string, unknown>;
      cleaned[key] = Object.fromEntries(
        Object.entries(props).map(([k, v]) => [k, cleanSchemaWithDefs(v, nextDefs, refStack)])
      );
    } else if (key === 'items' && value) {
      if (Array.isArray(value)) {
        cleaned[key] = value.map((entry) => cleanSchemaWithDefs(entry, nextDefs, refStack));
      } else if (typeof value === 'object') {
        cleaned[key] = cleanSchemaWithDefs(value, nextDefs, refStack);
      } else {
        cleaned[key] = value;
      }
    } else if (key === 'anyOf' && Array.isArray(value)) {
      cleaned[key] = cleanedAnyOf ?? value.map((variant) => cleanSchemaWithDefs(variant, nextDefs, refStack));
    } else if (key === 'oneOf' && Array.isArray(value)) {
      cleaned[key] = cleanedOneOf ?? value.map((variant) => cleanSchemaWithDefs(variant, nextDefs, refStack));
    } else if (key === 'allOf' && Array.isArray(value)) {
      cleaned[key] = value.map((variant) => cleanSchemaWithDefs(variant, nextDefs, refStack));
    } else {
      cleaned[key] = value;
    }
  }

  return cleaned;
}

/**
 * Clean a schema for provider compatibility
 * Removes unsupported keywords, resolves $refs, flattens unions
 */
export function cleanSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(cleanSchema);

  const defs = extendSchemaDefs(undefined, schema as Record<string, unknown>);
  return cleanSchemaWithDefs(schema, defs, undefined);
}

/**
 * Ensure a cleaned schema has valid type for its structure
 * Azure is strict about having explicit types on all schema objects
 */
function ensureValidType(schema: Record<string, unknown>): Record<string, unknown> {
  // If it has properties or additionalProperties, it's an object
  if ('properties' in schema || 'additionalProperties' in schema) {
    return { ...schema, type: 'object' };
  }
  // If it has items, it's an array
  if ('items' in schema) {
    return { ...schema, type: 'array' };
  }
  // If it has enum with values, infer type from first value
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const firstValue = schema.enum[0];
    const inferredType = typeof firstValue;
    if (['string', 'number', 'boolean'].includes(inferredType)) {
      return { ...schema, type: inferredType };
    }
  }
  // Default to string if no type can be inferred
  if (!schema.type) {
    return { ...schema, type: 'string' };
  }
  return schema;
}

/**
 * Recursively ensure all nested schemas have valid types
 */
function ensureNestedTypes(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return schema;
  }

  const obj = schema as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (key === 'properties' && value && typeof value === 'object' && !Array.isArray(value)) {
      // Recursively fix property schemas
      const props = value as Record<string, unknown>;
      result[key] = Object.fromEntries(
        Object.entries(props).map(([k, v]) => {
          if (v && typeof v === 'object' && !Array.isArray(v)) {
            const fixed = ensureNestedTypes(v) as Record<string, unknown>;
            return [k, ensureValidType(fixed)];
          }
          return [k, v];
        })
      );
    } else if (key === 'items' && value && typeof value === 'object') {
      if (Array.isArray(value)) {
        result[key] = value.map((item) => {
          if (item && typeof item === 'object' && !Array.isArray(item)) {
            const fixed = ensureNestedTypes(item) as Record<string, unknown>;
            return ensureValidType(fixed);
          }
          return item;
        });
      } else {
        const fixed = ensureNestedTypes(value) as Record<string, unknown>;
        result[key] = ensureValidType(fixed);
      }
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Normalize tool parameters for provider compatibility
 * Ensures top-level type: "object" and cleans the schema
 * Guarantees Azure-compatible output
 */
export function normalizeToolSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== 'object') {
    return { type: 'object', properties: {} };
  }

  const obj = schema as Record<string, unknown>;

  // If already has type + properties without top-level anyOf, just clean it
  if ('type' in obj && 'properties' in obj && !Array.isArray(obj.anyOf)) {
    const cleaned = cleanSchema(obj) as Record<string, unknown>;
    const withTypes = ensureNestedTypes(cleaned) as Record<string, unknown>;
    // Ensure top-level always has type: object and properties
    return {
      type: 'object',
      ...withTypes,
      properties: withTypes.properties ?? {},
    };
  }

  // Force type: "object" if missing but has object-like fields
  if (
    !('type' in obj) &&
    (typeof obj.properties === 'object' || Array.isArray(obj.required)) &&
    !Array.isArray(obj.anyOf) &&
    !Array.isArray(obj.oneOf)
  ) {
    const cleaned = cleanSchema({ ...obj, type: 'object' }) as Record<string, unknown>;
    const withTypes = ensureNestedTypes(cleaned) as Record<string, unknown>;
    return {
      type: 'object',
      ...withTypes,
      properties: withTypes.properties ?? {},
    };
  }

  // Handle union schemas (anyOf/oneOf) by flattening
  const variantKey = Array.isArray(obj.anyOf) ? 'anyOf' : Array.isArray(obj.oneOf) ? 'oneOf' : null;
  if (!variantKey) {
    // No union, just clean
    const cleaned = cleanSchema(obj) as Record<string, unknown>;
    const withTypes = ensureNestedTypes(cleaned) as Record<string, unknown>;
    // Always ensure type: object and properties for tool parameters
    return {
      type: 'object',
      ...withTypes,
      properties: withTypes.properties ?? {},
    };
  }

  // Flatten union variants
  const variants = obj[variantKey] as unknown[];
  const mergedProperties: Record<string, unknown> = {};
  const requiredCounts = new Map<string, number>();
  let objectVariants = 0;

  for (const entry of variants) {
    if (!entry || typeof entry !== 'object') continue;
    const props = (entry as { properties?: unknown }).properties;
    if (!props || typeof props !== 'object') continue;
    objectVariants += 1;
    for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
      if (!(key in mergedProperties)) {
        mergedProperties[key] = value;
        continue;
      }
      mergedProperties[key] = mergePropertySchemas(mergedProperties[key], value);
    }
    const required = Array.isArray((entry as { required?: unknown }).required)
      ? (entry as { required: unknown[] }).required
      : [];
    for (const key of required) {
      if (typeof key !== 'string') continue;
      requiredCounts.set(key, (requiredCounts.get(key) ?? 0) + 1);
    }
  }

  const baseRequired = Array.isArray(obj.required)
    ? obj.required.filter((key) => typeof key === 'string')
    : undefined;
  const mergedRequired = baseRequired && baseRequired.length > 0
    ? baseRequired
    : objectVariants > 0
      ? Array.from(requiredCounts.entries())
          .filter(([, count]) => count === objectVariants)
          .map(([key]) => key)
      : undefined;

  const cleaned = cleanSchema({
    type: 'object',
    ...(typeof obj.title === 'string' ? { title: obj.title } : {}),
    ...(typeof obj.description === 'string' ? { description: obj.description } : {}),
    properties: Object.keys(mergedProperties).length > 0 ? mergedProperties : (obj.properties ?? {}),
    ...(mergedRequired && mergedRequired.length > 0 ? { required: mergedRequired } : {}),
  }) as Record<string, unknown>;

  const withTypes = ensureNestedTypes(cleaned) as Record<string, unknown>;
  return {
    type: 'object',
    ...withTypes,
    properties: withTypes.properties ?? {},
  };
}
