"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
//CORE DEPENDENCIES
const mongoose = require("mongoose");
//CORE FRAMEWORK
const hcSession_1 = require("../../hc-core/hcSession/hcSession");
const hcMetaData_1 = require("../../hc-core/hcMetaData/hcMetaData");
const amqpConnectionDynamic_1 = require("./amqpConnectionDynamic");
class EMSession extends hcSession_1.HcSession {
    constructor(mongoService, amqpService) {
        super();
        //Mongo Configuration
        this._urlMongoConnection = 'mongodb://' + mongoService;
        //AMQP Configuration
        if (amqpService) {
            this._urlAmqpConnection = 'amqp://' + amqpService;
            //defaluts
            this._limitAmqpRetry = 10;
            this._periodAmqpRetry = 2000;
        }
    }
    connect() {
        let connectDb = () => { this._mongooseConnection = mongoose.createConnection(this._urlMongoConnection); };
        if (this._urlAmqpConnection) {
            connectDb();
            return this.atachToBroker();
        }
        else
            return new Promise((resolve, reject) => {
                connectDb();
                resolve();
            });
    }
    atachToBroker() {
        return new Promise((resolve, reject) => {
            amqpConnectionDynamic_1.AMQPConnectionDynamic.connect(this._urlAmqpConnection, { period: this._periodAmqpRetry, limit: this._limitAmqpRetry }).then(connection => {
                this._brokerConnection = connection;
                amqpConnectionDynamic_1.AMQPConnectionDynamic.createExchangeAndQueues(connection, this._amqpExchangesDescription, this._amqpQueueBindsDescription).then(channel => {
                    this._brokerChannel = channel;
                    resolve();
                }, error => reject(error));
            }, error => reject(error));
        });
    }
    getModel(entityName) {
        return (this.entitiesInfo.find(e => e.name == entityName).model);
    }
    getInfo(entityName) {
        return this.entitiesInfo.find(info => info.name == entityName).info;
    }
    //registerEntity<TDocument extends mongoose.Document, TEntity extends EMEntity>(entityName: string, structureSchema : Object, type: { new( session: EMSession, document : EntityDocument ) : TEntity} ) : void
    registerEntity(type, entityInfo) {
        //var info : EntityInfo = (<any>type).entityInfo; 
        var structureSchema = entityInfo.getCompleteSchema();
        var entityName = entityInfo.name;
        if (this.entitiesInfo.filter(e => e.name == entityName).length == 0) {
            var schema;
            var model;
            //schema = <mongoose.Schema>( this._mongooseInstance.Schema(structureSchema) );
            schema = new mongoose.Schema(structureSchema);
            model = this._mongooseConnection.model(entityName, schema);
            this.addEntityInfo({
                name: entityName,
                info: entityInfo,
                schema: schema,
                model: model,
                activateType: (d) => {
                    return new type(this, d);
                }
            });
        }
        else
            console.warn('Attempt to duplicate entity already registered: ' + entityName);
    }
    createDocument(entityName, document) {
        return new Promise((resolve, reject) => {
            // let model = this.getModel<T>(entityName);
            this.manageDocumentCreation(document);
            // model.create(document).then( 
            //     value => resolve(value), 
            //     error => reject( this.createError(error, 'Error in create document' ))
            // );
            document.save().then(value => resolve(value), error => reject(this.createError(error, 'Error in create document')));
        });
    }
    updateDocument(entityName, document) {
        return new Promise((resolve, reject) => {
            let model = this.getModel(entityName);
            this.manageDocumentUpdate(document);
            // model.findByIdAndUpdate( document._id, document, (error, result) => {
            // model.findByIdAndUpdate( document._id, { $set: document }, (error, result) => {
            //     if (!error)
            //     {
            //         this.findDocument(entityName, document._id).then(
            //             res => resolve(<T>res),
            //             err => reject(err)
            //         );
            //     }
            //     else
            //         reject( this.createError(error, 'Error in update document') );
            // } );
            document.update(document).then(value => {
                model.findById(document.id, (err, doc) => {
                    if (err)
                        reject(this.createError(err, 'The document was updated but it could not be reloaded'));
                    else
                        resolve(doc);
                });
            }, error => reject(this.createError(error, 'Error in update document')));
        });
    }
    listDocuments(entityName, options) {
        return new Promise((resolve, reject) => {
            //PREPARE QUERY PARAMETERS =====>>>>>           
            let skip = options != null && options.skip != null ? options.skip : 0;
            let take = options != null && options.take != null ? options.take : null;
            //Set mongo filters attending options.
            //First Monto object or SessionFilters instead
            let mongoFilters = options != null && options.mongoFilters ? options.mongoFilters : null;
            if (!mongoFilters)
                mongoFilters = this.resolveToMongoFilters(entityName, options != null && options.filters != null ? options.filters : null);
            if (mongoFilters.error)
                reject(this.createError(null, mongoFilters.message));
            let mongoSorting = this.resolveToMongoSorting(entityName, options != null && options.sorting != null ? options.sorting : null);
            if (mongoSorting != null && mongoSorting.error)
                reject(this.createError(null, mongoSorting.message));
            //CREATE QUERY =====>>>>>
            let query = this.getModel(entityName).find(mongoFilters.filters);
            if (mongoSorting != null && mongoSorting.sorting != null)
                query = query.sort(mongoSorting.sorting);
            if (skip > 0)
                query = query.skip(skip);
            if (take != null)
                query = query.limit(take);
            //EXECUTE QUERY =====>>>>>
            query.exec((error, result) => {
                if (!error)
                    resolve(result);
                else
                    reject(this.createError(error, 'Error in retrive docments'));
            });
        });
    }
    findDocument(entityName, id) {
        return new Promise((resolve, reject) => {
            this.getModel(entityName).where("deferredDeletion").ne(true).where("_id", id).then(res => resolve(res != null && res.length > 0 ? res[0] : null), err => reject(this.createError(err, 'Error in retrive single document')));
        });
    }
    deleteDocument(entityName, document) {
        return new Promise((resolve, reject) => {
            let model = this.getModel(entityName);
            this.manageDocumentDeletion(document);
            model.findByIdAndUpdate(document._id, document, (error, result) => {
                if (!error)
                    resolve();
                else
                    reject(this.createError(error, 'Error in delete document'));
            });
        });
    }
    activateEntityInstance(info, document) {
        return new Promise((resolve, reject) => {
            let baseInstace = this.entitiesInfo.find(a => a.name == info.name).activateType(document);
            let entityAccessors = info.getAccessors().filter(a => a.activator != null);
            if (entityAccessors.length > 0) {
                let promises = [];
                entityAccessors.forEach(entityAccessor => promises.push(entityAccessor.activator.activateMember(baseInstace, this, entityAccessor)));
                Promise.all(promises).then(() => resolve(baseInstace), error => reject(this.createError(error, 'Error in create instance of a member')));
            }
            else
                resolve(baseInstace);
        });
    }
    getMetadataToExpose(entityName) {
        let info = (this.entitiesInfo.find(e => e.name == entityName).info);
        return info.getAccessors().filter(accessor => accessor.exposition).map(accessor => {
            return {
                name: accessor.name,
                type: accessor.type,
                expositionType: accessor.exposition,
                persistent: (accessor.schema != null || accessor.persistenceType == hcMetaData_1.PersistenceType.Auto)
            };
        });
    }
    findEntity(info, id) {
        return new Promise((resolve, reject) => {
            this.findDocument(info.name, id).then(docResult => this.activateEntityInstance(info, docResult).then(entityInstance => resolve(entityInstance), error => reject(error)), error => reject(error));
        });
    }
    listEntities(entityName, options) {
        return new Promise((resolve, reject) => {
            this.listDocuments(entityName, options).then(docsResult => {
                let entities = new Array();
                let promises = new Array();
                docsResult.forEach(docResult => {
                    promises.push(this.activateEntityInstance(this.getInfo(entityName), docResult).then(entity => { entities.push(entity); }));
                });
                Promise.all(promises).then(() => resolve(entities), error => reject(error));
            }, error => reject(error));
        });
    }
    listDocumentsByQuery(entityName, mongoFilters) {
        return new Promise((resolve, reject) => {
            let filters = { $and: [{ deferredDeletion: { $in: [null, false] } }] };
            if (mongoFilters instanceof Array)
                filters.$and = filters.$and.concat(mongoFilters);
            else
                filters.$and.push(mongoFilters);
            this.getModel(entityName).find(filters).then(docs => resolve(docs), err => reject(this.createError(err, 'Error on list documents')));
        });
    }
    listEntitiesByQuery(info, mongoFilters) {
        return new Promise((resolve, reject) => {
            this.listDocumentsByQuery(info.name, mongoFilters).then(docsResult => {
                let entities = new Array();
                let promises = new Array();
                docsResult.forEach(docResult => {
                    promises.push(this.activateEntityInstance(info, docResult).then(entity => { entities.push(entity); }));
                });
                Promise.all(promises).then(() => resolve(entities), error => reject(error));
            });
        });
    }
    enableDevMode() {
        this._devMode = true;
    }
    disableDevMode() {
        this._devMode = false;
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
    manageDocumentCreation(document) {
        document.created = new Date();
        document.deferredDeletion = false;
    }
    manageDocumentUpdate(document) {
        document.modified = new Date();
    }
    manageDocumentDeletion(document) {
        document.deleted = new Date();
        document.deferredDeletion = true;
    }
    resolveToMongoFilters(entityName, filters) {
        let info = this.entitiesInfo.find(f => f.name == entityName).info;
        //Cambio
        let persistentMembers = info.getAllMembers()
            .filter(m => (m instanceof hcMetaData_1.AccessorInfo) && (m.schema != null || m.persistenceType == hcMetaData_1.PersistenceType.Auto))
            .map(m => {
            return { property: m.name, type: m.type, serializeAlias: m.serializeAlias, persistentAlias: m.persistentAlias };
        });
        //Base mongo filters
        let mongoFilters;
        // Convert all the fixed and optional filters in Mongoose Filetrs
        if (filters != null && filters.length > 0) {
            mongoFilters = { $and: [{ deferredDeletion: { $in: [null, false] } }] };
            // mongoFilters = { $and : [ { deferredDeletion: false } ] };
            let opFilters = [];
            let errFilters;
            //get all filters
            for (let filter of filters) {
                let pMember = persistentMembers.find(pm => pm.property == filter.property || pm.serializeAlias == filter.property || pm.persistentAlias == filter.property);
                if (pMember == null) {
                    errFilters = 'Attempt to filter by a non persistent member';
                    break;
                }
                //Single mongo filter
                let persistentName = pMember.persistentAlias ? pMember.persistentAlias : pMember.property;
                let mongoFilterConversion = this.parseMongoFilter(filter, pMember.type, persistentName);
                if (mongoFilterConversion.err) {
                    errFilters = mongoFilterConversion.message;
                    break;
                }
                if (filter.filterType == FilterType.Fixed)
                    mongoFilters.$and.push(mongoFilterConversion.value);
                if (filter.filterType == FilterType.Optional)
                    opFilters.push(mongoFilterConversion.value);
            }
            if (opFilters.length > 0) {
                if (opFilters.length > 1)
                    mongoFilters.$and.push({ $or: opFilters });
                else
                    mongoFilters.$and.push(opFilters[0]);
            }
            if (errFilters != null)
                return { error: true, message: errFilters };
        }
        else {
            mongoFilters = { deferredDeletion: { $in: [null, false] } };
            // mongoFilters = { deferredDeletion: false };
        }
        return { error: false, filters: mongoFilters };
    }
    parseMongoFilter(f, propertyType, persistentName) {
        //Check and convert the filter value 
        let valueFilter; //value to mongo query
        switch (propertyType) {
            case 'Number':
                if (isNaN(f.value))
                    return { err: true, message: `The value for a filter in the property "${persistentName}" must be a number` };
                else
                    valueFilter = parseInt(f.value);
                break;
            default:
                valueFilter = f.value;
        }
        ;
        //Set the table of conversions for filters and mongo filters 
        let configConvesions = [
            { operators: ['=', 'eq'] },
            { operators: ['<>', 'ne'], mongoOperator: '$ne' },
            { operators: ['>=', 'gte'], mongoOperator: '$gte', filterTypes: ['Number', 'Date'], },
            { operators: ['<=', 'lte'], mongoOperator: '$lte', filterTypes: ['Number', 'Date'] },
            { operators: ['>', 'gt'], mongoOperator: '$gt', filterTypes: ['Number', 'Date'] },
            { operators: ['<', 'lt'], mongoOperator: '$lt', filterTypes: ['Number', 'Date'] },
            { operators: ['lk'], mongoOperator: '$regex', filterTypes: ['String'], valueModifier: (v) => { return '.*' + v + '.*'; } }
        ];
        //Make the conversion 
        let confIndex = -1;
        let conf = configConvesions.find(cc => cc.operators.find(o => o == f.operator) != null);
        if (conf != null) {
            valueFilter = conf.valueModifier != null ? conf.valueModifier(valueFilter) : valueFilter;
            if (conf.filterTypes == null || (conf.filterTypes != null && conf.filterTypes.find(at => at == propertyType) != null)) {
                let value;
                if (conf.mongoOperator)
                    value = { [persistentName]: { [conf.mongoOperator]: valueFilter } };
                else
                    value = { [persistentName]: valueFilter };
                return { err: false, value };
            }
            else
                return { err: true, message: `It is not possible to apply the the operator "${f.operator}" to the property "${persistentName}" because it is of type "${propertyType}"` };
        }
        else
            return { err: true, message: `Not valid operator ${f.operator} for filtering` };
    }
    resolveToMongoSorting(entityName, sorting) {
        if (sorting != null && sorting.length > 0) {
            let info = this.entitiesInfo.find(f => f.name == entityName).info;
            let persistentMembers = info.getAllMembers().filter(m => (m instanceof hcMetaData_1.AccessorInfo) && m.schema != null).map(m => { return { property: m.name, type: m.type }; });
            let errSorting;
            let mongoSorting = {};
            for (let sort of sorting) {
                let pMember = persistentMembers.find(pm => pm.property == sort.property);
                if (pMember == null) {
                    errSorting = 'Attempt to sort by a non persistent member';
                    break;
                }
                let mst;
                if (sort.sortType == SortType.ascending)
                    mst = 'asc';
                if (sort.sortType == SortType.descending)
                    mst = 'desc';
                mongoSorting[sort.property] = mst;
            }
            if (errSorting != null)
                return { error: true, message: errSorting };
            return { error: false, sorting: mongoSorting };
        }
        else
            return null;
    }
    throwException(message) {
        if (this._devMode)
            console.error('DEV-MODE: ' + message);
        else
            throw new Error(message);
    }
    throwInfo(message, warnDevMode) {
        warnDevMode = warnDevMode != null ? warnDevMode : true;
        if (warnDevMode && this._devMode)
            console.warn('DEV-MODE: ' + message);
        else
            console.info(message);
    }
    //#endregion
    //#region Accessors (Properties)
    get isDevMode() { return this._devMode; }
    get periodAmqpRetry() { return this._periodAmqpRetry; }
    set periodAmqpRetry(value) { this._periodAmqpRetry = value; }
    get limitAmqpRetry() { return this._limitAmqpRetry; }
    set limitAmqpRetry(value) { this._limitAmqpRetry = value; }
    get mongooseConnection() { return this._mongooseConnection; }
    get brokerConnection() { return this._brokerConnection; }
    get brokerChannel() { return this._brokerChannel; }
    get amqpExchangesDescription() { return this._amqpExchangesDescription; }
    set amqpExchangesDescription(value) { this._amqpExchangesDescription = value; }
    get amqpQueueBindsDescription() { return this._amqpQueueBindsDescription; }
    set amqpQueueBindsDescription(value) { this._amqpQueueBindsDescription = value; }
}
exports.EMSession = EMSession;
class EMSessionError {
    constructor(error, message) {
        this.error = error;
        this.message = message;
    }
}
exports.EMSessionError = EMSessionError;
var FilterType;
(function (FilterType) {
    FilterType[FilterType["Fixed"] = 1] = "Fixed";
    FilterType[FilterType["Optional"] = 2] = "Optional";
})(FilterType || (FilterType = {}));
exports.FilterType = FilterType;
var SortType;
(function (SortType) {
    SortType[SortType["ascending"] = 1] = "ascending";
    SortType[SortType["descending"] = 2] = "descending";
})(SortType || (SortType = {}));
exports.SortType = SortType;
//# sourceMappingURL=emSession.js.map