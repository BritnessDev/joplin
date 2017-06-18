import { promiseChain } from 'src/promise-utils.js';

class FileApi {

	constructor(baseDir, driver) {
		this.baseDir_ = baseDir;
		this.driver_ = driver;
	}

	fullPath_(path) {
		let output = this.baseDir_;
		if (path != '') output += '/' + path;
		return output;
	}

	scopeItemToBaseDir_(item) {
		let output = Object.assign({}, item);
		output.path = item.path.substr(this.baseDir_.length + 1);
		return output;
	}

	scopeItemsToBaseDir_(items) {
		let output = [];
		for (let i = 0; i < items.length; i++) {
			output.push(this.scopeItemToBaseDir_(items[i]));
		}
		return output;
	}

	listDirectories() {
		return this.driver_.list(this.fullPath_('')).then((items) => {
			let output = [];
			for (let i = 0; i < items.length; i++) {
				if (items[i].isDir) output.push(this.scopeItemToBaseDir_(items[i]));
			}
			return output;
		});
	}

	list() {
		return this.driver_.list(this.baseDir_).then((items) => {
			return this.scopeItemsToBaseDir_(items);
		});
	}

	setTimestamp(path, timestamp) {
		return this.driver_.setTimestamp(this.fullPath_(path), timestamp);
	}

	mkdir(path) {
		console.info('mkdir ' + path);
		return this.driver_.mkdir(this.fullPath_(path));
	}

	stat(path) {
		return this.driver_.stat(this.fullPath_(path)).then((output) => {
			if (!output) return output;
			output.path = path;
			return output;
		});
	}

	get(path) {
		return this.driver_.get(this.fullPath_(path));
	}

	put(path, content) {
		return this.driver_.put(this.fullPath_(path), content);
	}

	delete(path) {
		return this.driver_.delete(this.fullPath_(path));
	}

	move(oldPath, newPath) {
		return this.driver_.move(this.fullPath_(oldPath), this.fullPath_(newPath));
	}

	format() {
		return this.driver_.format();
	}

}

export { FileApi };