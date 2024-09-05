'use strict';

const meta = require('../meta');
const plugins = require('../plugins');
const slugify = require('../slugify');
const db = require('../database');

module.exports = function (Groups) {
	Groups.create = async function (data) {
		// Determine basic properties
		const timestamp = data.timestamp || Date.now();
		const isSystem = isSystemGroup(data);
		const disableJoinRequests = getDisableJoinRequests(data);
		const disableLeave = parseInt(data.disableLeave, 10) === 1 ? 1 : 0;
		const isHidden = parseInt(data.hidden, 10) === 1;
		const isPrivate = data.private ? parseInt(data.private, 10) === 1 : true;
		const memberCount = data.ownerUid ? 1 : 0;

		// Validate group name
		Groups.validateGroupName(data.name);

		// Check for existing groups
		await checkGroupExistence(data.name);

		const a = disableLeave;
		const b = memberCount;
		const c = disableJoinRequests;
		const d = isPrivate;
		const e = isHidden;

		// Create group data
		const groupData = createGroupData(data, timestamp, isSystem, e, d, c, a, b);
		// Fire hooks and save group data
		await plugins.hooks.fire('filter:group.create', { group: groupData, data });
		await saveGroupData(groupData, data.ownerUid, timestamp);

		// Return updated group data
		const updatedGroupData = await Groups.getGroupData(groupData.name);
		plugins.hooks.fire('action:group.create', { group: updatedGroupData });
		return updatedGroupData;
	};

	function getDisableJoinRequests(data) {
		if (data.name === 'administrators') return 1;
		return parseInt(data.disableJoinRequests, 10) === 1 ? 1 : 0;
	}

	async function checkGroupExistence(name) {
		const [exists, privGroupExists] = await Promise.all([
			meta.userOrGroupExists(name),
			privilegeGroupExists(name),
		]);
		if (exists || privGroupExists) {
			throw new Error('[[error:group-already-exists]]');
		}
	}

	mock_data = {data, timestamp}

	// Function to create group data
	function createGroupData(mock_data, isSystem, isHidden, isPrivate,
		disableJoinRequests, disableLeave, memberCount) {
		data = mock_data.data
		timestamp = mock_data.timestamp
		return {
			name: data.name,
			slug: slugify(data.name),
			createtime: timestamp,
			userTitle: data.userTitle || data.name,
			userTitleEnabled: parseInt(data.userTitleEnabled, 10) === 1 ? 1 : 0,
			description: data.description || '',
			memberCount,
			hidden: isHidden ? 1 : 0,
			system: isSystem ? 1 : 0,
			private: isPrivate ? 1 : 0,
			disableJoinRequests,
			disableLeave,
		};
	}

	async function saveGroupData(groupData, ownerUid, timestamp) {
		await db.sortedSetAdd('groups:createtime', groupData.createtime, groupData.name);
		await db.setObject(`group:${groupData.name}`, groupData);

		if (ownerUid) {
			await db.setAdd(`group:${groupData.name}:owners`, ownerUid);
			await db.sortedSetAdd(`group:${groupData.name}:members`, timestamp, ownerUid);
		}

		if (!groupData.hidden && !groupData.system) {
			await db.sortedSetAddBulk([
				['groups:visible:createtime', timestamp, groupData.name],
				['groups:visible:memberCount', groupData.memberCount, groupData.name],
				['groups:visible:name', 0, `${groupData.name.toLowerCase()}:${groupData.name}`],
			]);
		}

		if (!Groups.isPrivilegeGroup(groupData.name)) {
			await db.setObjectField('groupslug:groupname', groupData.slug, groupData.name);
		}
	}

	async function privilegeGroupExists(name) {
		return Groups.isPrivilegeGroup(name) && await db.isSortedSetMember('groups:createtime', name);
	}

	function isSystemGroup(data) {
		return data.system === true || parseInt(data.system, 10) === 1 ||
			Groups.systemGroups.includes(data.name) ||
			Groups.isPrivilegeGroup(data.name);
	}

	Groups.validateGroupName = function (name) {
		if (!name) {
			throw new Error('[[error:group-name-too-short]]');
		}

		if (typeof name !== 'string') {
			throw new Error('[[error:invalid-group-name]]');
		}

		if (!Groups.isPrivilegeGroup(name) && name.length > meta.config.maximumGroupNameLength) {
			throw new Error('[[error:group-name-too-long]]');
		}

		if (name === 'guests' || (!Groups.isPrivilegeGroup(name) && name.includes(':'))) {
			throw new Error('[[error:invalid-group-name]]');
		}

		if (name.includes('/') || !slugify(name)) {
			throw new Error('[[error:invalid-group-name]]');
		}
	};
};
