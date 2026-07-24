export type FilterValue = string | number | boolean | null;

type DatabaseClient = {
  from(table: string): any;
};

export type SelectInput = {
  table: string;
  columns: string[];
  filters: Record<string, FilterValue>;
  limit: number;
};

export type InsertInput = {
  table: string;
  rows: Record<string, unknown>[];
};

export type UpdateInput = {
  table: string;
  values: Record<string, unknown>;
  filters: Record<string, FilterValue>;
};

export function createDatabaseGateway(
  client: DatabaseClient,
  allowedTables: ReadonlySet<string>,
) {
  const table = (name: string) => {
    if (!allowedTables.has(name)) {
      throw new Error(`Table "${name}" is not allowed`);
    }
    return client.from(name);
  };

  const filtered = (
    query: any,
    filters: Record<string, FilterValue>,
  ) => {
    for (const [column, value] of Object.entries(filters)) {
      query = value === null ? query.is(column, null) : query.eq(column, value);
    }
    return query;
  };

  const data = async (query: any) => {
    const result = await query;
    if (result.error) {
      throw new Error(`Supabase query failed: ${result.error.message}`);
    }
    return result.data;
  };

  return {
    async selectRows(input: SelectInput): Promise<unknown> {
      const query = filtered(
        table(input.table).select(input.columns.join(",")),
        input.filters,
      ).limit(input.limit);
      return data(query);
    },
    async insertRows(input: InsertInput): Promise<unknown> {
      return data(table(input.table).insert(input.rows).select("*"));
    },
    async updateRows(input: UpdateInput): Promise<unknown> {
      if (!Object.keys(input.filters).length) {
        throw new Error("At least one update filter is required");
      }
      return data(
        filtered(
          table(input.table).update(input.values),
          input.filters,
        ).select("*"),
      );
    },
  };
}

export type DatabaseGateway = ReturnType<typeof createDatabaseGateway>;
