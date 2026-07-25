export type FilterValue = string | number | boolean | null;

export type QueryCondition =
  | {
      column: string;
      operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte";
      value: FilterValue;
    }
  | {
      column: string;
      operator: "like" | "ilike";
      value: string;
    }
  | {
      column: string;
      operator: "in";
      value: Exclude<FilterValue, null>[];
    }
  | {
      column: string;
      operator: "is";
      value: boolean | null;
    };

export type QueryOrder = {
  column: string;
  direction: "asc" | "desc";
};

type DatabaseClient = {
  from(table: string): any;
};

export type SelectInput = {
  table: string;
  columns: string[];
  filters: Record<string, FilterValue>;
  conditions: QueryCondition[];
  orderBy: QueryOrder[];
  limit: number;
  offset: number;
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

  const conditioned = (
    query: any,
    conditions: QueryCondition[],
  ) => {
    for (const condition of conditions) {
      query = query[condition.operator](
        condition.column,
        condition.value,
      );
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
      let query = conditioned(
        filtered(
          table(input.table).select(input.columns.join(",")),
          input.filters,
        ),
        input.conditions,
      );
      for (const order of input.orderBy) {
        query = query.order(order.column, {
          ascending: order.direction === "asc",
        });
      }
      return data(
        query.range(
          input.offset,
          input.offset + input.limit - 1,
        ),
      );
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
