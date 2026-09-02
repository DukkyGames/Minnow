export interface PluginListItem {
  id: string;
  label: string;
  description: string;
  category: string;
  functionName: string;
  namespacedName: string;
}

export interface PluginToolMeta extends PluginListItem {
  /** User pack under ~/.minnow/tools/<id>/ */
  source: 'user';
}
