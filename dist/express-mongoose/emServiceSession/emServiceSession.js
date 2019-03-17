"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
//CORE DEPENDENCIES
const mongoose = require("mongoose");
const redis = require("redis");
//CORE FRAMEWORK
const amqpConnectionDynamic_1 = require("../../amqp-events/amqp-connection/amqpConnectionDynamic");
const AMQPEventManager_1 = require("../../amqp-events/amqp-event-manager/AMQPEventManager");
class EMServiceSession {
    constructor(serviceName, mongoService, options) {
        //Utilities
        this._userDevDataNotification = false;
        this._serviceName = serviceName;
        this._entitiesInfo = [];
        this._brokerChannels = new Array();
        this._allowFixedSystemOwners = false;
        //Mongo Configuration
        this._mongoServiceConfig = mongoService;
        //AMQP Configuration
        if (options && options.amqpService) {
            this._urlAmqpConnection = 'amqp://' + options.amqpService;
            //defaluts
            this._limitAmqpRetry = 10;
            this._periodAmqpRetry = 2000;
        }
        //RedisCache Configuration
        if (options && options.cacheService) {
            this._cacheService = options.cacheService;
        }
        //Reports Service
        if (options && options.reportsService) {
            this._reportsService = options.reportsService;
        }
    }
    connect() {
        let asyncConn = new Array();
        asyncConn.push(new Promise((resolve, reject) => {
            if (typeof this._mongoServiceConfig == "string") {
                let url = 'mongodb://' + this._mongoServiceConfig;
                this._mongooseConnection = mongoose.createConnection(url);
            }
            else {
                let config = this._mongoServiceConfig;
                let base = config.base || 'mongodb://';
                let url = base + config.url;
                this._mongooseConnection = mongoose.createConnection(url, { user: config.user, pass: config.password });
            }
            //Pending to validate async result
            resolve();
        }));
        asyncConn.push(new Promise((resolve, reject) => {
            if (this._urlAmqpConnection)
                this.atachToBroker().then(() => resolve()).catch(error => reject(error));
            else
                resolve();
        }));
        asyncConn.push(new Promise((resolve, reject) => {
            if (this._cacheService) {
                this._authCacheClient = redis.createClient({ host: this._cacheService.host, port: this._cacheService.port });
                this._authCacheClient.on("error ", err => this.throwException(err));
                //Pending to validate async result
                resolve();
            }
            else
                resolve();
        }));
        return Promise.all(asyncConn).then(() => { }).catch(error => this.throwException(error));
    }
    atachToBroker() {
        return new Promise((resolve, reject) => {
            amqpConnectionDynamic_1.AMQPConnectionDynamic.connect(this._urlAmqpConnection, { period: this._periodAmqpRetry, limit: this._limitAmqpRetry }).then(connection => {
                this._brokerConnection = connection;
                resolve();
            }).catch(err => reject(err));
        });
    }
    createAndBindEventManager() {
        this._amqpEventManager = new AMQPEventManager_1.AMQPEventManager(this);
        return this._amqpEventManager;
    }
    publishAMQPMessage(session, eventName, data) {
        if (this._amqpEventManager)
            this._amqpEventManager.publish(eventName, data, { session });
        else
            this.throwException('No AMQP Event manager binded');
    }
    publishAMQPAction(session, methodInfo, entityId, data) {
        if (this._amqpEventManager)
            this._amqpEventManager.publish(methodInfo.eventName, data, { session, entityName: methodInfo.className, actionName: methodInfo.name, entityId });
        else
            this.throwException('No AMQP Event manager binded');
    }
    getInfo(entityName) {
        let infoRegister = this._entitiesInfo.find(e => e.name == entityName);
        if (!infoRegister)
            this.throwException('Entity not registered: ' + entityName);
        return infoRegister.info;
    }
    getModel(entityName, systemOwner) {
        let infoRegister = this._entitiesInfo.find(e => e.name == entityName);
        if (!infoRegister)
            this.throwException('Entity not registered: ' + entityName);
        let model;
        if (infoRegister.info.fixedSystemOwner) {
            systemOwner = infoRegister.info.fixedSystemOwner;
            let modelRegister = infoRegister.models.find(m => m.systemOwner == systemOwner);
            if (!modelRegister) {
                let modelName = systemOwner + '_' + infoRegister.name;
                model = infoRegister.modelActivator.activate(this._mongooseConnection, modelName, infoRegister.schema);
                infoRegister.models.push({ systemOwner: systemOwner, model });
            }
            else
                model = modelRegister.model;
        }
        else {
            let modelRegister = infoRegister.models.find(m => m.systemOwner == systemOwner);
            if (!modelRegister)
                this.throwException(`Model ${entityName} not registered for System Owner ${systemOwner}`);
            model = modelRegister.model;
        }
        return model;
    }
    registerEntity(type, entityInfo) {
        var structureSchema = entityInfo.getCompleteSchema();
        var entityName = entityInfo.name;
        if (this.entitiesInfo.filter(e => e.name == entityName).length == 0) {
            var schema;
            var model;
            schema = new mongoose.Schema(structureSchema);
            this._entitiesInfo.push({
                name: entityName,
                info: entityInfo,
                schema: schema,
                models: [],
                activateType: (s, d) => {
                    return new type(s, d);
                },
                modelActivator: new ModelActivator()
            });
        }
        else
            console.warn('Attempt to duplicate entity already registered: ' + entityName);
    }
    createDeveloperModels() {
        this._entitiesInfo.forEach(ei => {
            let devData = this.getDeveloperUserData({ skipNotification: true });
            let modelName = devData.systemOwnerSelected + '_' + ei.name;
            let model = ei.modelActivator.activate(this._mongooseConnection, modelName, ei.schema);
            ei.models.push({ systemOwner: devData.systemOwnerSelected, model });
        });
    }
    verifySystemOwnerModels(systemOwner) {
        this._entitiesInfo.filter(ei => ei.models.find(m => m.systemOwner == systemOwner) == null && ei.info.fixedSystemOwner == null).forEach(ei => {
            let modelName = systemOwner + '_' + ei.name;
            let model = ei.modelActivator.activate(this._mongooseConnection, modelName, ei.schema);
            ei.models.push({ systemOwner, model });
        });
    }
    enableDevMode() {
        this._devMode = true;
    }
    disableDevMode() {
        this._devMode = false;
    }
    throwException(message) {
        if (this._devMode)
            console.error('DEV-MODE: ' + message);
        else
            throw new Error(message);
    }
    logInDevMode(message, type) {
        if (this._devMode == true) {
            let msg = 'DEV-MODE: ' + message;
            switch (type) {
                case 'error':
                    console.error(msg);
                    break;
                case 'warn':
                    console.warn(msg);
                    break;
                case 'info':
                    console.info(msg);
                    break;
                default:
                    console.log(msg);
            }
        }
    }
    throwInfo(message, warnDevMode) {
        warnDevMode = warnDevMode != null ? warnDevMode : true;
        if (warnDevMode && this._devMode)
            console.warn('DEV-MODE: ' + message);
        else
            console.info(message);
    }
    createError(error, message) {
        if (this._devMode) {
            let m = 'DevMode: Error in EMSession => ' + message;
            console.warn(m);
            return new EMSessionError(error, m);
        }
        else
            return new EMSessionError(null, 'INTERNAL SERVER ERROR');
    }
    checkAMQPConnection() {
        if (!this._urlAmqpConnection || !this._brokerConnection)
            this.throwException('No AMQP service enabled');
    }
    enableFixedSystemOwners() {
        this._allowFixedSystemOwners = true;
    }
    getDeveloperUserData(options) {
        if (this.isDevMode) {
            options = options || {};
            let skipNotification = options.skipNotification != null ? options.skipNotification : false;
            if (!this._userDevDataNotification && !skipNotification) {
                this.logInDevMode('Using private user data for developer in the created sessions');
                this._userDevDataNotification = true;
            }
            return {
                name: 'LOCAL DEVELOPER',
                userName: 'DEVELOPER',
                systemOwnerSelected: 'DEVELOPER',
                idUser: null,
                sessionKey: null
            };
        }
        else {
            this.throwException('It is not possible to use the Developer User Data without activate DevMode');
            return null;
        }
    }
    //#endregion
    //#region Accessors
    get serviceName() { return this._serviceName; }
    get entitiesInfo() { return this._entitiesInfo; }
    get isDevMode() { return this._devMode; }
    get periodAmqpRetry() { return this._periodAmqpRetry; }
    set periodAmqpRetry(value) { this._periodAmqpRetry = value; }
    get limitAmqpRetry() { return this._limitAmqpRetry; }
    set limitAmqpRetry(value) { this._limitAmqpRetry = value; }
    get mongooseConnection() { return this._mongooseConnection; }
    get brokerConnection() { return this._brokerConnection; }
    get brokerChannels() { return this._brokerChannels; }
    get amqpExchangesDescription() { return this._amqpExchangesDescription; }
    set amqpExchangesDescription(value) { this._amqpExchangesDescription = value; }
    get amqpQueueBindsDescription() { return this._amqpQueueBindsDescription; }
    set amqpQueueBindsDescription(value) { this._amqpQueueBindsDescription = value; }
    get mainChannel() {
        let mc = this._brokerChannels.find(c => c.name == 'mainChannel');
        if (!mc)
            this.throwException('Main broker channel not found');
        return mc.instance;
    }
    get allowFixedSystemOwners() { return this._allowFixedSystemOwners; }
    get authCacheClient() { return this._authCacheClient; }
    get reportsService() { return this._reportsService; }
}
exports.EMServiceSession = EMServiceSession;
class ModelActivator {
    constructor() { }
    activate(mongooseConnection, name, schema) {
        return mongooseConnection.model(name, schema);
    }
}
class EMSessionError {
    //#endregion
    //#region Methods
    constructor(error, message) {
        this._error = error;
        this._message = message;
        this._code = 500;
    }
    setAsHandledError(code, message) {
        this._code = code;
        this._message = message;
        this._isHandled = true;
    }
    //#endregion
    //#region Accessors
    get error() { return this._error; }
    get message() { return this._message; }
    get code() { return this._code; }
    get isHandled() { return this._isHandled; }
}
exports.EMSessionError = EMSessionError;
//# sourceMappingURL=emServiceSession.js.map