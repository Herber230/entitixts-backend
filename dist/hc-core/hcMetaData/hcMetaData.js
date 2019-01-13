"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const util_1 = require("util");
const hcSession_1 = require("../hcSession/hcSession");
function DefinedEntity(params) {
    return function (target) {
        //var entityInfo = checkMetadata(target);
        //target.prototype.entityInfo.name = params.name;
        let tempPackageName = params != null && params.packageName != null ? params.packageName : 'app';
        let tempIsAbstract = params != null && params.abstract != null ? params.abstract : false;
        //let info = defineMetaData( target, CreationType.class );
        if (!target.prototype.entityInfo)
            target.prototype.entityInfo = new EntityInfo(target.name);
        let info = target.prototype.entityInfo;
        if (info.name != target.name) {
            let options = {
                fixedSystemOwner: params ? params.fixedSystemOwner : null
            };
            let newInfo = new EntityInfo(target.name, options);
            newInfo.implementBaseInfo(info, tempIsAbstract);
            newInfo.packageName = tempPackageName;
            target.prototype.entityInfo = newInfo;
        }
    };
}
exports.DefinedEntity = DefinedEntity;
function DefinedAccessor(params) {
    params = params || {};
    return function (target, key, descriptor) {
        var entityInfo = defineMetaData(target, CreationType.member);
        var reflectInfo = Reflect.getMetadata('design:type', target, key);
        var info = new AccessorInfo();
        info.name = key;
        info.schema = params.schema;
        info.className = target.constructor.name;
        info.type = reflectInfo.name;
        info.persistenceType = params.persistenceType || PersistenceType.Defined;
        info.activator = params.activator;
        if (params.alias)
            info.setAlias(params.alias);
        if (params.serializeAlias)
            info.serializeAlias = params.serializeAlias;
        if (params.persistentAlias)
            info.persistentAlias = params.persistentAlias;
        if (params.exposition)
            info.exposition = params.exposition;
        if (params.persistenceType && params.persistenceType == PersistenceType.Auto && params.schema)
            console.warn(`The Persistence type for ${key} is defined as Auto, so the defined Schema will be ignored`);
        if (reflectInfo.name == 'Object' && params.persistenceType != PersistenceType.Auto)
            console.warn(`It seems the accessor ${key} does not have an explicit type. Please make sure that the type name it is not necessary in the exposed metadata`);
        entityInfo.addAccessorInfo(info);
    };
}
exports.DefinedAccessor = DefinedAccessor;
function DefinedProperty() {
    return function (target, key) {
        //To be programmed
    };
}
const definedParamKey = Symbol("definedParam");
function DefinedParam(paramName, required) {
    if (!paramName)
        throw "Name param is required";
    return function (target, propertyKey, parameterIndex) {
        required = required != null ? required : false;
        let definedParameters = Reflect.getOwnMetadata(definedParamKey, target, propertyKey) || new Array();
        definedParameters.push({ name: paramName, index: parameterIndex, required });
        Reflect.defineMetadata(definedParamKey, definedParameters, target, propertyKey);
    };
}
exports.DefinedParam = DefinedParam;
function SessionParam() {
    return function (target, propertyKey, parameterIndex) {
        let definedParameters = Reflect.getOwnMetadata(definedParamKey, target, propertyKey) || new Array();
        definedParameters.push({ name: 'session', index: parameterIndex, special: true });
        Reflect.defineMetadata(definedParamKey, definedParameters, target, propertyKey);
    };
}
exports.SessionParam = SessionParam;
function DefinedMethod(params) {
    return function (target, propertyName, descriptor) {
        params = params || {};
        let entityInfo = defineMetaData(target, CreationType.member);
        let methodInfo = new MethodInfo();
        methodInfo.name = propertyName;
        methodInfo.className = target.constructor.name;
        methodInfo.parameters = Reflect.getOwnMetadata(definedParamKey, target, propertyName);
        methodInfo.eventName = params.eventName;
        entityInfo.addMethodInfo(methodInfo);
        let originalMethod = descriptor.value;
        descriptor.value = function () {
            let params = new Array();
            let userParamArray = new Array();
            let specialParamArray = new Array();
            for (let a in arguments) {
                let argument = arguments[a];
                if (argument.hasOwnProperty('key') && argument.hasOwnProperty('value')) {
                    let key = argument.key;
                    let value = argument.value;
                    userParamArray.push({ key, value });
                }
                else if (argument instanceof hcSession_1.HcSession) {
                    specialParamArray.push({ key: 'session', value: argument });
                }
            }
            let limit = Math.max(...methodInfo.parameters.map(dp => dp.index));
            for (let i = 0; i <= limit; i++) {
                let defParam = methodInfo.parameters.find(dp => dp.index == i);
                if (defParam) {
                    let arg;
                    if (defParam.special == true)
                        arg = specialParamArray.find(a => a.key == defParam.name);
                    else
                        arg = userParamArray.find(a => a.key == defParam.name);
                    params.push(arg ? arg.value : null);
                }
                else
                    params.push(null);
            }
            return originalMethod.apply(this, params);
        };
    };
}
exports.DefinedMethod = DefinedMethod;
// function DefinedMethod ( params? : { } )
// {
//     params = params || { };
//     return function (target: any, key: string, descriptor : PropertyDescriptor)
//     {
//         let entityInfo = defineMetaData(target, CreationType.member);
//         let reflectInfo = Reflect.getMetadata('design:type', target, key);
//         let methodInfo = new MethodInfo();
//         methodInfo.name = key;
//         methodInfo.className = target.constructor.name;
//         entityInfo.addMethodInfo(methodInfo);
//     }
// }
function defineMetaData(objectWithMetadata, creationType) {
    let info;
    switch (creationType) {
        case CreationType.member:
            {
                if (!objectWithMetadata.entityInfo)
                    objectWithMetadata.entityInfo = new EntityInfo(objectWithMetadata.constructor.name);
                ;
                info = objectWithMetadata.entityInfo;
            }
        case CreationType.class:
            {
                // It is not possible access the prototype here
            }
    }
    if (!info)
        throw new util_1.error('It was not possible to construct the metadata for the Object');
    return info;
}
var CreationType;
(function (CreationType) {
    CreationType[CreationType["member"] = 1] = "member";
    CreationType[CreationType["class"] = 2] = "class";
})(CreationType || (CreationType = {}));
function isMetaDataInfo(object) {
    return 'entityInfo' in object;
}
class EntityInfo {
    constructor(name, options) {
        this._name = name;
        this._definedMembers = new Array();
        this._isAbstract = true;
        if (options) {
            this._fixedSystemOwner = options.fixedSystemOwner;
        }
    }
    addAccessorInfo(accessorInfo) {
        this._definedMembers.push(accessorInfo);
    }
    addPropertyInfo(propertyInfo) {
        this._definedMembers.push(propertyInfo);
    }
    addMethodInfo(methodInfo) {
        this._definedMembers.push(methodInfo);
    }
    getAllMembers() {
        let allMembers = new Array();
        let tempInfo = this;
        while (tempInfo) {
            allMembers = allMembers.concat(tempInfo._definedMembers);
            tempInfo = tempInfo.base;
        }
        return allMembers;
    }
    getAccessors() {
        return this.getAllMembers().filter(e => e instanceof AccessorInfo).map(e => e);
    }
    getDefinedMethods() {
        return this.getAllMembers().filter(e => e instanceof MethodInfo).map(e => e);
    }
    getAccessorSchemas() {
        return this.getAllMembers().filter(e => e instanceof AccessorInfo && e.schema != null && e.persistenceType == PersistenceType.Defined).map(e => { return { accessorName: e.name, accessorSchema: e.schema, alias: e.persistentAlias }; });
    }
    getCompleteSchema() {
        var schema = {};
        this.getAccessorSchemas().forEach(schemaProperty => {
            let persistentName = schemaProperty.alias ? schemaProperty.alias : schemaProperty.accessorName;
            schema[persistentName] = schemaProperty.accessorSchema;
        });
        return schema;
    }
    implementBaseInfo(baseInfo, isAbstract) {
        if (isAbstract != null)
            this._isAbstract = isAbstract;
        if (baseInfo._definedMembers != null && baseInfo._definedMembers.length > 0) {
            let i = 0;
            while (baseInfo._definedMembers.length > i) {
                let member = baseInfo._definedMembers[i];
                if (member.className == this._name) {
                    baseInfo._definedMembers.splice(i, 1);
                    this._definedMembers.push(member);
                }
                else
                    i++;
            }
        }
        this._base = baseInfo;
    }
    static implementAbstractInfo(info) {
        info._isAbstract = false;
    }
    //#endregion
    //#region Accessors
    get name() { return this._name; }
    set name(value) { this._name = value; }
    get packageName() { return this._packageName; }
    set packageName(value) { this._packageName = value; }
    get base() { return this._base; }
    get isAbstract() { return this._isAbstract; }
    get fixedSystemOwner() { return this._fixedSystemOwner; }
}
exports.EntityInfo = EntityInfo;
class MemberActivator {
    //#endregion
    //#region Methods
    constructor(info) {
        this._entityInfo = info;
    }
    //#endregion
    //#region Accessors
    get entityInfo() { return this._entityInfo; }
}
exports.MemberActivator = MemberActivator;
class MemberInfo {
    //#endregion
    //#region Methods
    constructor() {
    }
    //#endregion
    //#region Accessors
    get name() { return this._name; }
    set name(value) { this._name = value; }
    get className() { return this._className; }
    set className(value) { this._className = value; }
    get packageName() { return this._packageName; }
    set packageName(value) { this._packageName = value; }
    get type() { return this._type; }
    set type(value) { this._type = value; }
}
exports.MemberInfo = MemberInfo;
class PropertyInfo extends MemberInfo {
    //#region Properties
    //#endregion
    //#region Methods
    constructor() {
        super();
    }
}
exports.PropertyInfo = PropertyInfo;
class AccessorInfo extends MemberInfo {
    //#endregion
    //#region Methods
    constructor() {
        super();
        this._persistenceType = PersistenceType.Defined;
    }
    setAlias(alias) {
        this._persistentAlias = alias;
        this._serializeAlias = alias;
    }
    //#endregion
    //#region Accessors
    get exposition() { return this._exposition; }
    set exposition(value) { this._exposition = value; }
    get schema() { return this._schema; }
    set schema(value) { this._schema = value; }
    get persistenceType() { return this._persistenceType; }
    set persistenceType(value) { this._persistenceType = value; }
    get serializeAlias() { return this._serializeAlias; }
    set serializeAlias(value) { this._serializeAlias = value; }
    get persistentAlias() { return this._persistentAlias; }
    set persistentAlias(value) { this._persistentAlias = value; }
    get activator() { return this._activator; }
    set activator(value) { this._activator = value; }
}
exports.AccessorInfo = AccessorInfo;
class MethodInfo extends MemberInfo {
    //#endregion
    //#region Methods
    constructor() {
        super();
        this._parameters = new Array();
    }
    //#endregion
    //#region Accessors
    get parameters() { return this._parameters; }
    set parameters(value) { this._parameters = value; }
    get eventName() { return this._eventName; }
    set eventName(value) { this._eventName = value; }
}
exports.MethodInfo = MethodInfo;
var PersistenceType;
(function (PersistenceType) {
    PersistenceType[PersistenceType["Defined"] = 1] = "Defined";
    PersistenceType[PersistenceType["Auto"] = 2] = "Auto";
})(PersistenceType || (PersistenceType = {}));
exports.PersistenceType = PersistenceType;
var ExpositionType;
(function (ExpositionType) {
    ExpositionType["Normal"] = "normal";
    ExpositionType["ReadOnly"] = "readOnly";
})(ExpositionType || (ExpositionType = {}));
exports.ExpositionType = ExpositionType;
var MemberBindingType;
(function (MemberBindingType) {
    MemberBindingType[MemberBindingType["Reference"] = 1] = "Reference";
    MemberBindingType[MemberBindingType["Snapshot"] = 2] = "Snapshot";
})(MemberBindingType || (MemberBindingType = {}));
exports.MemberBindingType = MemberBindingType;
//# sourceMappingURL=hcMetaData.js.map