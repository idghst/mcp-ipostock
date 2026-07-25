export type TableColumn = {
  name: string;
  type: string;
  nullable: boolean;
  required: boolean;
};

export type TableDescription = {
  table: string;
  columns: TableColumn[];
};

export type SchemaGateway = {
  describeTable(table: string): Promise<TableDescription>;
  assertColumns(table: string, columns: readonly string[]): Promise<void>;
};

type SchemaOptions = {
  supabaseUrl: string;
  supabaseKey: string;
  allowedTables: ReadonlySet<string>;
  fetchImpl?: typeof fetch;
};

const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

export function createSchemaGateway({
  supabaseUrl,
  supabaseKey,
  allowedTables,
  fetchImpl = fetch,
}: SchemaOptions): SchemaGateway {
  let definitionsPromise: Promise<Record<string, unknown>> | undefined;

  const definitions = () => {
    definitionsPromise ??= (async () => {
      const response = await fetchImpl(
        `${supabaseUrl.replace(/\/$/, "")}/rest/v1/`,
        {
          headers: {
            apikey: supabaseKey,
            Accept: "application/openapi+json",
          },
        },
      );
      if (!response.ok) {
        throw new Error(
          `Supabase schema request failed: HTTP ${response.status}`,
        );
      }
      return object(object(await response.json())?.definitions) ?? {};
    })();
    return definitionsPromise;
  };

  const describeTable = async (table: string) => {
    if (!allowedTables.has(table)) {
      throw new Error(`Table "${table}" is not allowed`);
    }

    const definition = object((await definitions())[table]);
    if (!definition) {
      throw new Error(`Table "${table}" was not found in the Supabase schema`);
    }

    const requiredNames = Array.isArray(definition.required)
      ? definition.required.filter(
          (name): name is string => typeof name === "string",
        )
      : [];
    const required = new Set(requiredNames);
    const properties = object(definition.properties) ?? {};
    const columns = Object.entries(properties).map(([name, value]) => {
      const property = object(value) ?? {};
      const isRequired = required.has(name);
      const nullable =
        typeof property.nullable === "boolean"
          ? property.nullable
          : typeof property["x-nullable"] === "boolean"
            ? property["x-nullable"]
            : !isRequired;
      const type =
        (typeof property.format === "string" && property.format) ||
        (typeof property.type === "string" && property.type) ||
        "unknown";
      return {
        name,
        type,
        nullable,
        required: isRequired,
      };
    });

    return { table, columns };
  };

  return {
    describeTable,
    async assertColumns(table, columns) {
      const description = await describeTable(table);
      const known = new Set(description.columns.map(({ name }) => name));
      for (const column of columns) {
        if (!known.has(column)) {
          throw new Error(
            `Column "${column}" was not found in table "${table}"`,
          );
        }
      }
    },
  };
}
