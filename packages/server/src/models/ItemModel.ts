import BaseModel, { SaveOptions, LoadOptions, DeleteOptions, ValidateOptions, AclAction } from './BaseModel';
import { ItemType, databaseSchema, Uuid, Item, ShareType, Share, ChangeType, User } from '../db';
import { defaultPagination, paginateDbQuery, PaginatedResults, Pagination } from './utils/pagination';
import { isJoplinItemName, isJoplinResourceBlobPath, linkedResourceIds, serializeJoplinItem, unserializeJoplinItem } from '../utils/joplinUtils';
import { ModelType } from '@joplin/lib/BaseModel';
import { ApiError, ErrorForbidden, ErrorNotFound, ErrorPayloadTooLarge, ErrorUnprocessableEntity } from '../utils/errors';
import { Knex } from 'knex';
import { ChangePreviousItem } from './ChangeModel';
import { _ } from '@joplin/lib/locale';

const prettyBytes = require('pretty-bytes');
const mimeUtils = require('@joplin/lib/mime-utils.js').mime;

// Converts "root:/myfile.txt:" to "myfile.txt"
const extractNameRegex = /^root:\/(.*):$/;

export interface PaginatedItems extends PaginatedResults {
	items: Item[];
}

export interface SharedRootInfo {
	item: Item;
	share: Share;
}

export interface ItemSaveOption extends SaveOptions {
	shareId?: Uuid;
}

export default class ItemModel extends BaseModel<Item> {

	protected get tableName(): string {
		return 'items';
	}

	protected get itemType(): ItemType {
		return ItemType.Item;
	}

	protected get hasParentId(): boolean {
		return false;
	}

	protected get defaultFields(): string[] {
		return Object.keys(databaseSchema[this.tableName]).filter(f => f !== 'content');
	}

	public async checkIfAllowed(user: User, action: AclAction, resource: Item = null): Promise<void> {
		if (action === AclAction.Create) {
			if (!(await this.models().shareUser().isShareParticipant(resource.jop_share_id, user.id))) throw new ErrorForbidden('user has no access to this share');
		}

		// if (action === AclAction.Delete) {
		// 	const share = await this.models().share().byItemId(resource.id);
		// 	if (share && share.type === ShareType.JoplinRootFolder) {
		// 		if (user.id !== share.owner_id) throw new ErrorForbidden('only the owner of the shared notebook can delete it');
		// 	}
		// }
	}

	public fromApiInput(item: Item): Item {
		const output: Item = {};

		if ('id' in item) item.id = output.id;
		if ('name' in item) item.name = output.name;
		if ('mime_type' in item) item.mime_type = output.mime_type;

		return output;
	}

	protected objectToApiOutput(object: Item): Item {
		const output: Item = {};
		const propNames = ['id', 'name', 'updated_time', 'created_time'];
		for (const k of Object.keys(object)) {
			if (propNames.includes(k)) (output as any)[k] = (object as any)[k];
		}
		return output;
	}

	public async userHasItem(userId: Uuid, itemId: Uuid): Promise<boolean> {
		const r = await this
			.db('user_items')
			.select('user_items.id')
			.where('user_items.user_id', '=', userId)
			.where('user_items.item_id', '=', itemId)
			.first();
		return !!r;
	}

	// Remove first and last colon from a path element
	public pathToName(path: string): string {
		if (path === 'root') return '';
		return path.replace(extractNameRegex, '$1');
	}

	public async byShareId(shareId: Uuid, options: LoadOptions = {}): Promise<Item[]> {
		return this
			.db('items')
			.select(this.selectFields(options, null, 'items'))
			.where('jop_share_id', '=', shareId);
	}

	public async loadByJopIds(userId: Uuid | Uuid[], jopIds: string[], options: LoadOptions = {}): Promise<Item[]> {
		if (!jopIds.length) return [];

		const userIds = Array.isArray(userId) ? userId : [userId];
		if (!userIds.length) return [];

		return this
			.db('user_items')
			.leftJoin('items', 'items.id', 'user_items.item_id')
			.distinct(this.selectFields(options, null, 'items'))
			.whereIn('user_items.user_id', userIds)
			.whereIn('jop_id', jopIds);
	}

	public async loadByJopId(userId: Uuid, jopId: string, options: LoadOptions = {}): Promise<Item> {
		const items = await this.loadByJopIds(userId, [jopId], options);
		return items.length ? items[0] : null;
	}

	public async loadByNames(userId: Uuid | Uuid[], names: string[], options: LoadOptions = {}): Promise<Item[]> {
		if (!names.length) return [];

		const userIds = Array.isArray(userId) ? userId : [userId];

		return this
			.db('user_items')
			.leftJoin('items', 'items.id', 'user_items.item_id')
			.distinct(this.selectFields(options, null, 'items'))
			.whereIn('user_items.user_id', userIds)
			.whereIn('name', names);
	}

	public async loadByName(userId: Uuid, name: string, options: LoadOptions = {}): Promise<Item> {
		const items = await this.loadByNames(userId, [name], options);
		return items.length ? items[0] : null;
	}

	public async loadWithContent(id: Uuid, options: LoadOptions = {}): Promise<Item> {
		return this
			.db('user_items')
			.leftJoin('items', 'items.id', 'user_items.item_id')
			.select(this.selectFields(options, ['*'], 'items'))
			.where('items.id', '=', id)
			.first();
	}

	public async loadAsSerializedJoplinItem(id: Uuid): Promise<string> {
		return serializeJoplinItem(await this.loadAsJoplinItem(id));
	}

	public async serializedContent(item: Item | Uuid): Promise<Buffer> {
		item = typeof item === 'string' ? await this.loadWithContent(item) : item;

		if (item.jop_type > 0) {
			return Buffer.from(await serializeJoplinItem(this.itemToJoplinItem(item)));
		} else {
			return item.content;
		}
	}

	public async sharedFolderChildrenItems(shareUserIds: Uuid[], folderId: string, includeResources: boolean = true): Promise<Item[]> {
		if (!shareUserIds.length) throw new Error('User IDs must be specified');

		let output: Item[] = [];

		const folderAndNotes: Item[] = await this
			.db('user_items')
			.leftJoin('items', 'items.id', 'user_items.item_id')
			.distinct('items.id', 'items.jop_id', 'items.jop_type')
			.where('items.jop_parent_id', '=', folderId)
			.whereIn('user_items.user_id', shareUserIds)
			.whereIn('jop_type', [ModelType.Folder, ModelType.Note]);

		for (const item of folderAndNotes) {
			output.push(item);

			if (item.jop_type === ModelType.Folder) {
				const children = await this.sharedFolderChildrenItems(shareUserIds, item.jop_id, false);
				output = output.concat(children);
			}
		}

		if (includeResources) {
			const noteItemIds = output.filter(i => i.jop_type === ModelType.Note).map(i => i.id);

			const itemResourceIds = await this.models().itemResource().byItemIds(noteItemIds);

			for (const itemId in itemResourceIds) {
				// TODO: should be resources with that path, that belong to any of the share users
				const resourceItems = await this.models().item().loadByJopIds(shareUserIds, itemResourceIds[itemId]);

				for (const resourceItem of resourceItems) {
					output.push({
						id: resourceItem.id,
						jop_id: resourceItem.jop_id,
						jop_type: ModelType.Resource,
					});
				}
			}

			let allResourceIds: string[] = [];
			for (const itemId in itemResourceIds) {
				allResourceIds = allResourceIds.concat(itemResourceIds[itemId]);
			}
			// TODO: should be resources with that path, that belong to any of the share users
			const blobItems = await this.models().itemResource().blobItemsByResourceIds(shareUserIds, allResourceIds);
			for (const blobItem of blobItems) {
				output.push({
					id: blobItem.id,
					name: blobItem.name,
				});
			}
		}

		return output;
	}

	// private async folderChildrenItems(userId: Uuid, folderId: string): Promise<Item[]> {
	// 	let output: Item[] = [];

	// 	const rows: Item[] = await this
	// 		.db('user_items')
	// 		.leftJoin('items', 'items.id', 'user_items.item_id')
	// 		.select('items.id', 'items.jop_id', 'items.jop_type')
	// 		.where('items.jop_parent_id', '=', folderId)
	// 		.where('user_items.user_id', '=', userId);

	// 	for (const row of rows) {
	// 		output.push(row);

	// 		if (row.jop_type === ModelType.Folder) {
	// 			const children = await this.folderChildrenItems(userId, row.jop_id);
	// 			output = output.concat(children);
	// 		}
	// 	}

	// 	return output;
	// }

	// public async shareJoplinFolderAndContent(shareId: Uuid, fromUserId: Uuid, toUserId: Uuid, folderId: string) {
	// 	const folderItem = await this.loadByJopId(fromUserId, folderId, { fields: ['id'] });
	// 	if (!folderItem) throw new ErrorNotFound(`Could not find folder "${folderId}" for share "${shareId}"`);

	// 	const items = [folderItem].concat(await this.folderChildrenItems(fromUserId, folderId));

	// 	const alreadySharedItemIds: string[] = await this
	// 		.db('user_items')
	// 		.pluck('item_id')
	// 		.whereIn('item_id', items.map(i => i.id))
	// 		.where('user_id', '=', toUserId)
	// 		// .where('share_id', '!=', '');

	// 	await this.withTransaction(async () => {
	// 		for (const item of items) {
	// 			if (alreadySharedItemIds.includes(item.id)) continue;
	// 			await this.models().userItem().add(toUserId, item.id, shareId);

	// 			if (item.jop_type === ModelType.Note) {
	// 				const resourceIds = await this.models().itemResource().byItemId(item.id);
	// 				await this.models().share().updateResourceShareStatus(true, shareId, fromUserId, toUserId, resourceIds);
	// 			}
	// 		}
	// 	});
	// }

	public itemToJoplinItem(itemRow: Item): any {
		if (itemRow.jop_type <= 0) throw new Error(`Not a Joplin item: ${itemRow.id}`);
		if (!itemRow.content) throw new Error('Item content is missing');
		const item = JSON.parse(itemRow.content.toString());

		item.id = itemRow.jop_id;
		item.parent_id = itemRow.jop_parent_id;
		item.share_id = itemRow.jop_share_id;
		item.type_ = itemRow.jop_type;
		item.encryption_applied = itemRow.jop_encryption_applied;

		return item;
	}

	public async loadAsJoplinItem(id: Uuid): Promise<any> {
		const raw = await this.loadWithContent(id);
		return this.itemToJoplinItem(raw);
	}

	public async saveFromRawContent(user: User, name: string, buffer: Buffer, options: ItemSaveOption = null): Promise<Item> {
		options = options || {};

		const existingItem = await this.loadByName(user.id, name);

		const isJoplinItem = isJoplinItemName(name);
		let isNote = false;
		let itemTitle = '';

		const item: Item = {
			name,
		};

		let resourceIds: string[] = [];

		if (isJoplinItem) {
			const joplinItem = await unserializeJoplinItem(buffer.toString());
			isNote = joplinItem.type_ === ModelType.Note;
			resourceIds = isNote ? linkedResourceIds(joplinItem.body) : [];

			item.jop_id = joplinItem.id;
			item.jop_parent_id = joplinItem.parent_id || '';
			item.jop_type = joplinItem.type_;
			item.jop_encryption_applied = joplinItem.encryption_applied || 0;
			item.jop_share_id = joplinItem.share_id || '';

			delete joplinItem.id;
			delete joplinItem.parent_id;
			delete joplinItem.share_id;
			delete joplinItem.type_;
			delete joplinItem.encryption_applied;

			itemTitle = joplinItem.title || '';

			item.content = Buffer.from(JSON.stringify(joplinItem));
		} else {
			item.content = buffer;
		}

		if (existingItem) item.id = existingItem.id;

		if (options.shareId) item.jop_share_id = options.shareId;

		// If the item is encrypted, we apply a multipler because encrypted
		// items can be much larger (seems to be up to twice the size but for
		// safety let's go with 2.2).
		const maxSize = user.max_item_size * (item.jop_encryption_applied ? 2.2 : 1);
		if (maxSize && buffer.byteLength > maxSize) {
			throw new ErrorPayloadTooLarge(_('Cannot save %s "%s" because it is larger than than the allowed limit (%s)',
				isNote ? _('note') : _('attachment'),
				itemTitle ? itemTitle : name,
				prettyBytes(user.max_item_size)
			));
		}

		return this.withTransaction<Item>(async () => {
			const savedItem = await this.saveForUser(user.id, item);

			if (isNote) {
				await this.models().itemResource().deleteByItemId(savedItem.id);
				await this.models().itemResource().addResourceIds(savedItem.id, resourceIds);
			}

			return savedItem;
		});
	}

	protected async validate(item: Item, options: ValidateOptions = {}): Promise<Item> {
		if (options.isNew) {
			if (!item.name) throw new ErrorUnprocessableEntity('name cannot be empty');
		} else {
			if ('name' in item && !item.name) throw new ErrorUnprocessableEntity('name cannot be empty');
		}

		return super.validate(item, options);
	}


	private childrenQuery(userId: Uuid, pathQuery: string = '', options: LoadOptions = {}): Knex.QueryBuilder {
		const query = this
			.db('user_items')
			.leftJoin('items', 'user_items.item_id', 'items.id')
			.select(this.selectFields(options, ['id', 'name', 'updated_time'], 'items'))
			.where('user_items.user_id', '=', userId);

		if (pathQuery) {
			// We support /* as a prefix only. Anywhere else would have
			// performance issue or requires a revert index.
			const sqlLike = pathQuery.replace(/\/\*$/g, '/%');
			void query.where('name', 'like', sqlLike);
		}

		return query;
	}

	public itemUrl(): string {
		return `${this.baseUrl}/items`;
	}

	public itemContentUrl(itemId: Uuid): string {
		return `${this.baseUrl}/items/${itemId}/content`;
	}

	public async children(userId: Uuid, pathQuery: string = '', pagination: Pagination = null, options: LoadOptions = {}): Promise<PaginatedItems> {
		pagination = pagination || defaultPagination();
		const query = this.childrenQuery(userId, pathQuery, options);
		return paginateDbQuery(query, pagination, 'items');
	}

	public async childrenCount(userId: Uuid, pathQuery: string = ''): Promise<number> {
		const query = this.childrenQuery(userId, pathQuery);
		const r = await query.countDistinct('items.id', { as: 'total' });
		return r[0].total;
	}

	private async joplinItemPath(jopId: string): Promise<Item[]> {
		// Use Recursive Common Table Expression to find path to given item
		// https://www.sqlite.org/lang_with.html#recursivecte

		// with recursive paths(id, jop_id, jop_parent_id) as (
		//     select id, jop_id, jop_parent_id from items where jop_id = '000000000000000000000000000000F1'
		//     union
		//     select items.id, items.jop_id, items.jop_parent_id
		//     from items join paths where items.jop_id = paths.jop_parent_id
		// )
		// select id, jop_id, jop_parent_id from paths;

		return this.db.withRecursive('paths', (qb: Knex.QueryBuilder) => {
			void qb.select('id', 'jop_id', 'jop_parent_id')
				.from('items')
				.where('jop_id', '=', jopId)
				.whereIn('jop_type', [ModelType.Note, ModelType.Folder])

				.union((qb: Knex.QueryBuilder) => {
					void qb
						.select('items.id', 'items.jop_id', 'items.jop_parent_id')
						.from('items')
						.join('paths', 'items.jop_id', 'paths.jop_parent_id')
						.whereIn('jop_type', [ModelType.Note, ModelType.Folder]);
				});
		}).select('id', 'jop_id', 'jop_parent_id').from('paths');
	}

	// If the note or folder is within a shared folder, this function returns
	// that shared folder. It returns null otherwise.
	public async joplinItemSharedRootInfo(jopId: string): Promise<SharedRootInfo | null> {
		const path = await this.joplinItemPath(jopId);
		if (!path.length) throw new ApiError(`Cannot retrieve path for item: ${jopId}`, null, 'noPathForItem');
		const rootFolderItem = path[path.length - 1];
		const share = await this.models().share().itemShare(ShareType.Folder, rootFolderItem.id);
		if (!share) return null;

		return {
			item: await this.load(rootFolderItem.id),
			share,
		};
	}

	public async allForDebug(): Promise<any[]> {
		const items = await this.all({ fields: ['*'] });
		return items.map(i => {
			if (!i.content) return i;
			i.content = i.content.toString() as any;
			return i;
		});
	}

	public shouldRecordChange(itemName: string): boolean {
		if (isJoplinItemName(itemName)) return true;
		if (isJoplinResourceBlobPath(itemName)) return true;
		return false;
	}

	public isRootSharedFolder(item: Item): boolean {
		return item.jop_type === ModelType.Folder && item.jop_parent_id === '' && !!item.jop_share_id;
	}

	// Returns the item IDs that are owned only by the given user. In other
	// words, the items that are not shared with anyone else. Such items
	// can be safely deleted when the user is deleted.
	public async exclusivelyOwnedItemIds(userId: Uuid): Promise<Uuid[]> {
		const query = this
			.db('items')
			.select(this.db.raw('items.id, count(user_items.item_id) as user_item_count'))
			.leftJoin('user_items', 'user_items.item_id', 'items.id')
			.whereIn('items.id', this.db('user_items').select('user_items.item_id').where('user_id', '=', userId))
			.groupBy('items.id');

		const rows: any[] = await query;
		return rows.filter(r => r.user_item_count === 1).map(r => r.id);
	}

	public async deleteExclusivelyOwnedItems(userId: Uuid) {
		const itemIds = await this.exclusivelyOwnedItemIds(userId);
		await this.delete(itemIds);
	}

	public async deleteAll(userId: Uuid): Promise<void> {
		while (true) {
			const page = await this.children(userId, '', { ...defaultPagination(), limit: 1000 });
			await this.delete(page.items.map(c => c.id));
			if (!page.has_more) break;
		}
	}

	public async delete(id: string | string[], options: DeleteOptions = {}): Promise<void> {
		const ids = typeof id === 'string' ? [id] : id;
		if (!ids.length) return;

		const shares = await this.models().share().byItemIds(ids);

		await this.withTransaction(async () => {
			await this.models().share().delete(shares.map(s => s.id));
			await this.models().userItem().deleteByItemIds(ids);
			await this.models().itemResource().deleteByItemIds(ids);

			await super.delete(ids, options);
		}, 'ItemModel::delete');
	}

	public async deleteForUser(userId: Uuid, item: Item): Promise<void> {
		if (this.isRootSharedFolder(item)) {
			const share = await this.models().share().byItemId(item.id);
			if (!share) throw new ErrorNotFound(`Cannot find share associated with item ${item.id}`);
			const userShare = await this.models().shareUser().byShareAndUserId(share.id, userId);
			if (!userShare) return;
			await this.models().shareUser().delete(userShare.id);
		} else {
			await this.delete(item.id);
		}
	}

	public async saveForUser(userId: Uuid, item: Item, options: SaveOptions = {}): Promise<Item> {
		if (!userId) throw new Error('userId is required');

		item = { ... item };
		const isNew = await this.isNew(item, options);

		if (item.content) {
			item.content_size = item.content.byteLength;
		}

		let previousItem: ChangePreviousItem = null;

		if (isNew) {
			if (!item.mime_type) item.mime_type = mimeUtils.fromFilename(item.name) || '';
		} else {
			const beforeSaveItem = (await this.load(item.id, { fields: ['name', 'jop_type', 'jop_parent_id', 'jop_share_id'] }));
			const resourceIds = beforeSaveItem.jop_type === ModelType.Note ? await this.models().itemResource().byItemId(item.id) : [];

			previousItem = {
				jop_parent_id: beforeSaveItem.jop_parent_id,
				name: beforeSaveItem.name,
				jop_resource_ids: resourceIds,
				jop_share_id: beforeSaveItem.jop_share_id,
			};
		}

		return this.withTransaction(async () => {
			item = await super.save(item, options);

			if (isNew) await this.models().userItem().add(userId, item.id);

			// We only record updates. This because Create and Update events are
			// per user, whenever a user_item is created or deleted.
			const changeItemName = item.name || previousItem.name;

			if (!isNew && this.shouldRecordChange(changeItemName)) {
				await this.models().change().save({
					item_type: this.itemType,
					item_id: item.id,
					item_name: changeItemName,
					type: isNew ? ChangeType.Create : ChangeType.Update,
					previous_item: previousItem ? this.models().change().serializePreviousItem(previousItem) : '',
					user_id: userId,
				});
			}

			return item;
		});
	}

	public async save(_item: Item, _options: SaveOptions = {}): Promise<Item> {
		throw new Error('Use saveForUser()');
		// return this.saveForUser('', item, options);
	}

}
