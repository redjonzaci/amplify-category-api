import { Field, FieldType, Index, Model } from '../schema-representation';

export abstract class StringDataSourceAdapter {
  constructor(schema: string) {
    this.parseSchema(schema);
  }

  public abstract getTablesList(): string[];

  public abstract getFields(tableName: string): Field[];

  public abstract getPrimaryKey(tableName: string): Index | null;

  public abstract getIndexes(tableName: string): Index[];

  protected abstract mapDataType(datatype: string, nullable: boolean, tableName: string, fieldName: string, columnType: string): FieldType;

  protected abstract parseSchema(schema: string): void;

  protected abstract setFields(fields: any[]): void;

  protected abstract setIndexes(indexes: any[]): void;

  protected abstract setTables(tables: any[]): void;

  public getModels(): Model[] {
    const tableNames = this.getTablesList();
    const models = [];
    for (const table of tableNames) {
      models.push(this.describeTable(table));
    }
    return models;
  }

  public describeTable(tableName: string): Model {
    // Retrieve the fields, primary key and indexes info
    const fields = this.getFields(tableName);
    const primaryKey = this.getPrimaryKey(tableName);
    const indexes = this.getIndexes(tableName);

    // Construct the model from the retrieved details
    const model = new Model(tableName);
    fields.forEach((field) => model.addField(field));
    primaryKey && model.setPrimaryKey(primaryKey.getFields());
    indexes.forEach((index) => model.addIndex(index.name, index.getFields()));
    return model;
  }
}