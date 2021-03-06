/*
 Copyright 2016, 2017 IBM All Rights Reserved.

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

	  http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
*/

'use strict';

var fs = require('fs-extra');
var path = require('path');
var util = require('util');
var utils = require('../utils');
var Constants = require('../Constants.js');
var Channel = require('../Channel.js');
var Peer = require('../Peer.js');
var EventHub = require('../EventHub.js');
var Orderer = require('../Orderer.js');
var Organization = require('../Organization.js');
var CertificateAuthority = require('../CertificateAuthority.js');
var FabricCA = require('fabric-ca-client');

var logger = utils.getLogger('NetworkConfig101.js');
var CHANNELS_CONFIG = 'channels';
var ORGS_CONFIG = 'organizations';
var PEERS_CONFIG = 'peers';
var ORDERERS_CONFIG = 'orderers';
var CAS_CONFIG = 'certificateAuthorities';
var TLS_CACERTS = 'tlsCACerts';
var ADMIN_PRIVATE_KEY = 'adminPrivateKey';
var ADMIN_CERT = 'signedCert';
var GRPC_CONNECTION_OPTIONS = 'grpcOptions';
var HTTP_CONNECTION_OPTIONS = 'httpOptions';
var URL = 'url';
var EVENT_URL = 'eventUrl';
var NAME = 'name';
var PEM = 'pem';
var PATH = 'path';
var REGISTRAR = 'registrar';
var ROLES = Constants.NetworkConfig.ROLES;

/**
 * This is an implementation of the [NetworkConfig]{@link module:api.NetworkConfig} API.
 * It will be used to work with the v1.0.1 version of a JSON based network configuration.
 *
 * @class
 * @extends module:api.NetworkConfig
 */
var NetworkConfig_1_0 = class {

	/**
	 * constructor
	 *
	 * @param {Object} network_config - Network Configuration as represented in a JSON object
	 */
	constructor(network_config, client_context) {
		logger.debug('constructor, network_config: ' + JSON.stringify(network_config));
		this._network_config = network_config;
		this._client_context = client_context;
	}

	mergeSettings(additions) {
		var method = 'mergeSettings';
		logger.debug('%s - additions start',method);
		if(additions && additions._network_config) {
			if(additions._network_config.client) {
				this._network_config.client = additions._network_config.client;
			}
			if(additions._network_config.channels) {
				this._network_config.channels = additions._network_config.channels;
			}
			if(additions._network_config.organizations) {
				this._network_config.organizations = additions._network_config.organizations;
			}
			if(additions._network_config.orderers) {
				this._network_config.orderers = additions._network_config.orderers;
			}
			if(additions._network_config.peers) {
				this._network_config.peers = additions._network_config.peers;
			}
			if(additions._network_config.certificateAuthorities) {
				this._network_config.certificateAuthorities = additions._network_config.certificateAuthorities;
			}
		}
	}

	hasClient() {
		if(this._network_config && this._network_config.client) {
			return true;
		}

		return false;
	}

	getClientConfig() {
		var result = {};
		if(this._network_config && this._network_config.client) {
			let client_config = this._network_config.client;
			if(client_config.organization) {
				result.organization = client_config.organization;
			}
			if(client_config.credentialStore) {
				result.credentialStore = {};
				if(client_config.credentialStore.path) {
					result.credentialStore.path = path.resolve(client_config.credentialStore.path);
				}
				for(let setting in client_config.credentialStore) {
					if(setting !== 'cryptoStore' && setting != 'path') {
						result.credentialStore[setting] = client_config.credentialStore[setting];
					}
				}
				if(client_config.credentialStore.cryptoStore) {
					result.credentialStore.cryptoStore = {};
					if(client_config.credentialStore.cryptoStore.path) {
						result.credentialStore.cryptoStore.path = path.resolve(client_config.credentialStore.cryptoStore.path);
					}
					for(let setting in client_config.credentialStore.cryptoStore) {
						if(setting != 'path') {
							result.credentialStore.cryptoStore[setting] = client_config.credentialStore.cryptoStore[setting];
						}
					}
				}
			}
		}

		return result;
	}

	getChannel(name) {
		var method = 'getChannel';
		logger.debug('%s - name %s',method, name);
		var channel = null;
		if(name && this._network_config && this._network_config[CHANNELS_CONFIG]) {
			var channel_config = this._network_config[CHANNELS_CONFIG][name];
			if(channel_config) {
				channel = new Channel(name, this._client_context);
				this._addPeers(channel);
				this._addOrderers(channel);
			}
		}

		return channel;
	}

	getPeer(name, channel_org) {
		var method = 'getPeer';
		logger.debug('%s - name %s',method, name);
		var peer = null;
		if(this._network_config && this._network_config[PEERS_CONFIG]) {
			let peer_config = this._network_config[PEERS_CONFIG][name];
			if(peer_config) {
				let opts = {};
				opts.pem = getTLSCACert(peer_config);
				Object.assign(opts, peer_config[GRPC_CONNECTION_OPTIONS]);
				peer = new Peer(peer_config[URL], opts);
				peer.setName(name);
				if(channel_org) {
					for(let i in ROLES) {
						if(typeof channel_org[ROLES[i]] === 'boolean') {
							peer.setRole(ROLES[i], channel_org[ROLES[i]]);
						}
					}
				}
			}
		}

		return peer;
	}

	getEventHub(name) {
		var method = 'getEventHub';
		logger.debug('%s - name %s',method, name);
		var event_hub = null;
		if(this._network_config && this._network_config[PEERS_CONFIG]) {
			let peer_config = this._network_config[PEERS_CONFIG][name];
			if(peer_config) {
				let opts = {};
				opts.pem = getTLSCACert(peer_config);
				Object.assign(opts, peer_config[GRPC_CONNECTION_OPTIONS]);
				event_hub = new EventHub(this._client_context);
				event_hub.setPeerAddr(peer_config[EVENT_URL], opts);
			}
		}

		return event_hub;
	}

	getOrderer(name) {
		var method = 'getOrderer';
		logger.debug('%s - name %s',method, name);
		var orderer = null;
		if(this._network_config && this._network_config[ORDERERS_CONFIG]) {
			let orderer_config = this._network_config[ORDERERS_CONFIG][name];
			if(orderer_config) {
				let opts = {};
				opts.pem = getTLSCACert(orderer_config);
				Object.assign(opts, orderer_config[GRPC_CONNECTION_OPTIONS]);
				orderer = new Orderer(orderer_config[URL], opts);
				orderer.setName(orderer_config[NAME]);
			}
		}

		return orderer;
	}

	getOrganization(name) {
		var method = 'getOrganization';
		logger.debug('%s - name %s',method, name);
		var organization = null;
		if(name && this._network_config && this._network_config[ORGS_CONFIG]) {
			var organization_config = this._network_config[ORGS_CONFIG][name];
			if(organization_config) {
				organization = new Organization(name, organization_config.mspid);
				if(organization_config[PEERS_CONFIG]) {
					for(let i in organization_config[PEERS_CONFIG]) {
						let peer_name = organization_config[PEERS_CONFIG][i];
						let peer = this.getPeer(peer_name);
						if(peer) organization.addPeer(peer);
					}
				}
				if(organization_config[CAS_CONFIG]) {
					for(let i in organization_config[CAS_CONFIG]) {
						let ca_name = organization_config[CAS_CONFIG][i];
						let ca = this.getCertificateAuthority(ca_name);
						if(ca) organization.addCertificateAuthority(ca);
					}
				}
				if(organization_config[ADMIN_PRIVATE_KEY]) {
					let key = getPEMfromConfig(organization_config[ADMIN_PRIVATE_KEY]);
					organization.setAdminPrivateKey(key);
				}
				if(organization_config[ADMIN_CERT]) {
					let cert = getPEMfromConfig(organization_config[ADMIN_CERT]);
					organization.setAdminCert(cert);
				}
			}
		}

		return organization;
	}

	getOrganizations() {
		var method = 'getOrganizations';
		logger.debug('%s - start',method);
		var organizations = [];
		if(this._network_config && this._network_config[ORGS_CONFIG]) {
			for(let organization_name in  this._network_config[ORGS_CONFIG]) {
				let organization = this.getOrganization(organization_name);
				organizations.push(organization);
			}
		}

		return organizations;
	}

	getCertificateAuthority(name) {
		var method = 'getCertificateAuthority';
		logger.debug('%s - name %s',method, name);
		var certificateAuthority = null;
		if(name && this._network_config && this._network_config[CAS_CONFIG]) {
			var certificateAuthority_config = this._network_config[CAS_CONFIG][name];
			if(certificateAuthority_config) {
				certificateAuthority = new CertificateAuthority(
					name,
					certificateAuthority_config[URL],
					certificateAuthority_config[HTTP_CONNECTION_OPTIONS],
					getTLSCACert(certificateAuthority_config),
					certificateAuthority_config[REGISTRAR]
				);
			}
		}

		return certificateAuthority;
	}

	/*
	 * Internal method to add orderer instances to a channel as defined
	 * by the network configuration
	 */
	_addOrderers(channel) {
		// get the organization list for this channel
		if(this._network_config &&
			this._network_config[CHANNELS_CONFIG] &&
			this._network_config[CHANNELS_CONFIG][channel.getName()] ) {
			let orderer_names = this._network_config[CHANNELS_CONFIG][channel.getName()][ORDERERS_CONFIG];
			if(Array.isArray(orderer_names)) for(let i in orderer_names){
				let orderer_name = orderer_names[i];
				let orderer = this.getOrderer(orderer_name);
				if(orderer) channel.addOrderer(orderer);
			}
		}
	}

	/*
	 * Internal method to add orderer instances to a channel as defined
	 * by the network configuration
	 */
	_addPeers(channel) {
		// get the organization list for this channel
		if(this._network_config &&
			this._network_config[CHANNELS_CONFIG] &&
			this._network_config[CHANNELS_CONFIG][channel.getName()] ) {
			let channel_peers = this._network_config[CHANNELS_CONFIG][channel.getName()][PEERS_CONFIG];
			if(channel_peers) for(let peer_name in channel_peers) {
				let channel_peer = channel_peers[peer_name];
				let peer = this.getPeer(peer_name, channel_peer);
				if(peer) channel.addPeer(peer);
			}
		}

	}
};

function getTLSCACert(config) {
	if(config && config[TLS_CACERTS]) {
		return getPEMfromConfig(config[TLS_CACERTS]);
	}
	return null;
}

function getPEMfromConfig(config) {
	var result = null;
	if(config) {
		if(config[PEM]) {
			// cert value is directly in the configuration
			result = config[PEM];
		} else if(config[PATH]) {
			// cert value is in a file
			result = readFileSync(config[PATH]);
			result = FabricCA.normalizeX509(result); //This removes line feed at end
			result = result + '\n';
		}
	}

	return result;
}

function readFileSync(config_path) {
	try {
		let config_loc = path.resolve(config_path);
		let data = fs.readFileSync(config_loc);
		return Buffer.from(data).toString();
	} catch(err) {
		logger.error('NetworkConfig101 - problem reading the PEM file :: ' + err);
		throw err;
	}
}

module.exports = NetworkConfig_1_0;
