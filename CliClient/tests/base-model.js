import { time } from 'src/time-utils.js';
import { setupDatabase, setupDatabaseAndSynchronizer, db, synchronizer, fileApi, sleep, clearDatabase, switchClient } from 'test-utils.js';
import { createFoldersAndNotes } from 'test-data.js';
import { Folder } from 'src/models/folder.js';
import { Note } from 'src/models/note.js';
import { Setting } from 'src/models/setting.js';
import { BaseItem } from 'src/models/base-item.js';
import { BaseModel } from 'src/base-model.js';

process.on('unhandledRejection', (reason, p) => {
	console.error('Unhandled promise rejection at: Promise', p, 'reason:', reason);
});

describe('BaseItem', function() {

	beforeEach( async (done) => {
		await setupDatabaseAndSynchronizer(1);
		switchClient(1);
		done();
	});

	it('should create a deleted_items record', async (done) => {
		let folder = await Folder.save({ title: 'folder1' });

		await Folder.delete(folder.id);

		let items = await BaseModel.deletedItems();

		expect(items.length).toBe(1);
		expect(items[0].item_id).toBe(folder.id);
		expect(items[0].item_type).toBe(folder.type_);

		let folders = await Folder.all();

		expect(folders.length).toBe(0);

		done();
	});

});