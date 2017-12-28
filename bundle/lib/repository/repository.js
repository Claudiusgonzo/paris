"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var entity_config_1 = require("../entity/entity.config");
var Observable_1 = require("rxjs/Observable");
var Subject_1 = require("rxjs/Subject");
var entity_field_1 = require("../entity/entity-field");
var data_transformers_service_1 = require("../services/data-transformers.service");
var cache_1 = require("../services/cache");
var value_objects_service_1 = require("../services/value-objects.service");
var _ = require("lodash");
var data_options_1 = require("../dataset/data.options");
var dataset_service_1 = require("../services/dataset.service");
var data_availability_enum_1 = require("../dataset/data-availability.enum");
var errors_service_1 = require("../services/errors.service");
var Repository = /** @class */ (function () {
    function Repository(entity, config, entityConstructor, dataStore, paris) {
        this.entity = entity;
        this.config = config;
        this.entityConstructor = entityConstructor;
        this.dataStore = dataStore;
        this.paris = paris;
        var getAllItems$ = this.query().map(function (dataSet) { return dataSet.items; });
        this._allItemsSubject$ = new Subject_1.Subject();
        this._allItems$ = Observable_1.Observable.merge(getAllItems$, this._allItemsSubject$.asObservable());
        this._saveSubject$ = new Subject_1.Subject();
        this._removeSubject$ = new Subject_1.Subject();
        this.save$ = this._saveSubject$.asObservable();
        this.remove$ = this._removeSubject$.asObservable();
    }
    Object.defineProperty(Repository.prototype, "allItems$", {
        get: function () {
            if (this._allValues)
                return Observable_1.Observable.merge(Observable_1.Observable.of(this._allValues), this._allItemsSubject$.asObservable());
            if (this.entity.loadAll)
                return this.setAllItems();
            return this._allItems$;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(Repository.prototype, "cache", {
        get: function () {
            var _this = this;
            if (!this._cache) {
                var cacheSettings = Object.assign({
                    getter: function (itemId) { return _this.getItemById(itemId, { allowCache: false }); }
                }, this.entity.cache);
                this._cache = new cache_1.DataCache(cacheSettings);
            }
            return this._cache;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(Repository.prototype, "baseUrl", {
        get: function () {
            if (!this.entity.baseUrl)
                return null;
            return this.entity.baseUrl instanceof Function ? this.entity.baseUrl(this.config) : this.entity.baseUrl;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(Repository.prototype, "endpointName", {
        get: function () {
            return this.entity.endpoint instanceof Function ? this.entity.endpoint(this.config) : this.entity.endpoint;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(Repository.prototype, "endpointUrl", {
        get: function () {
            return this.baseUrl + "/" + this.endpointName;
        },
        enumerable: true,
        configurable: true
    });
    Repository.prototype.createItem = function (itemData, options) {
        if (options === void 0) { options = { allowCache: true, availability: data_availability_enum_1.DataAvailability.available }; }
        return Repository.getModelData(itemData, this.entity, this.config, this.paris, options);
    };
    Repository.prototype.createNewItem = function () {
        var defaultData = {};
        this.entity.fieldsArray.forEach(function (field) {
            if (field.defaultValue !== undefined)
                defaultData[field.id] = field.defaultValue;
            else if (field.isArray)
                defaultData[field.id] = [];
        });
        return new this.entityConstructor(defaultData);
    };
    /**
     * Populates the item dataset with any sub @model. For example, if an ID is found for a property whose type is an entity,
     * the property's value will be an instance of that entity, for the ID, not the ID.
     * @param {Index} rawData
     * @param {EntityConfigBase} entity
     * @param {ParisConfig} config
     * @param {Paris} paris
     * @param {DataOptions} options
     * @returns {Observable<T extends EntityModelBase>}
     */
    Repository.getModelData = function (rawData, entity, config, paris, options) {
        if (options === void 0) { options = data_options_1.defaultDataOptions; }
        var entityIdProperty = entity.idProperty || config.entityIdProperty, modelData = entity instanceof entity_config_1.ModelEntity ? { id: rawData[entityIdProperty] } : {}, subModels = [];
        var getModelDataError = new Error("Failed to create " + entity.singularName + ".");
        entity.fields.forEach(function (entityField) {
            if (entityField.require) {
                var failed = false;
                if (entityField.require instanceof Function && !entityField.require(rawData, paris.config))
                    failed = true;
                else if (typeof (entityField.require) === "string") {
                    var rawDataPropertyValue = rawData[entityField.require];
                    if (rawDataPropertyValue === undefined || rawDataPropertyValue === null)
                        failed = true;
                }
                if (failed) {
                    modelData[entityField.id] = null;
                    return;
                }
            }
            var propertyValue;
            if (entityField.data) {
                if (entityField.data instanceof Array) {
                    for (var i = 0, path = void 0; i < entityField.data.length && propertyValue === undefined; i++) {
                        path = entityField.data[i];
                        var value = path === entity_field_1.FIELD_DATA_SELF ? rawData : _.get(rawData, path);
                        if (value !== undefined && value !== null)
                            propertyValue = value;
                    }
                }
                else
                    propertyValue = entityField.data === entity_field_1.FIELD_DATA_SELF ? rawData : _.get(rawData, entityField.data);
            }
            else
                propertyValue = rawData[entityField.id];
            if (entityField.parse) {
                try {
                    propertyValue = entityField.parse(propertyValue, rawData);
                }
                catch (e) {
                    getModelDataError.message = getModelDataError.message + (" Error parsing field " + entityField.id + ": ") + e.message;
                    throw getModelDataError;
                }
            }
            if (propertyValue === undefined || propertyValue === null) {
                var fieldRepository = paris.getRepository(entityField.type);
                var fieldValueObjectType = !fieldRepository && value_objects_service_1.valueObjectsService.getEntityByType(entityField.type);
                var defaultValue = fieldRepository && fieldRepository.entity.getDefaultValue()
                    || fieldValueObjectType && fieldValueObjectType.getDefaultValue()
                    || (entityField.isArray ? [] : entityField.defaultValue || null);
                if (!defaultValue && entityField.required) {
                    getModelDataError.message = getModelDataError.message + (" Field " + entityField.id + " is required but it's " + propertyValue + ".");
                    throw getModelDataError;
                }
                modelData[entityField.id] = defaultValue;
            }
            else {
                var getPropertyEntityValue$ = Repository.getSubModel(entityField, propertyValue, paris, config, options);
                if (getPropertyEntityValue$)
                    subModels.push(getPropertyEntityValue$);
                else {
                    modelData[entityField.id] = entityField.isArray
                        ? propertyValue
                            ? propertyValue.map(function (elementValue) { return data_transformers_service_1.DataTransformersService.parse(entityField.type, elementValue); })
                            : []
                        : data_transformers_service_1.DataTransformersService.parse(entityField.type, propertyValue);
                }
            }
        });
        var model$;
        if (subModels.length) {
            model$ = Observable_1.Observable.combineLatest.apply(Observable_1.Observable, subModels).map(function (propertyEntityValues) {
                propertyEntityValues.forEach(function (propertyEntityValue) { return Object.assign(modelData, propertyEntityValue); });
                var model;
                try {
                    model = new entity.entityConstructor(modelData, rawData);
                }
                catch (e) {
                    getModelDataError.message = getModelDataError.message + " Error: " + e.message;
                    throw getModelDataError;
                }
                propertyEntityValues.forEach(function (modelPropertyValue) {
                    for (var p in modelPropertyValue) {
                        var modelValue = modelPropertyValue[p];
                        if (modelValue instanceof Array)
                            modelValue.forEach(function (modelValueItem) {
                                if (!Object.isFrozen(modelValueItem))
                                    modelValueItem.$parent = model;
                            });
                        else if (!Object.isFrozen(modelValue))
                            modelValue.$parent = model;
                    }
                });
                return model;
            });
        }
        else {
            var model = void 0;
            try {
                model = new entity.entityConstructor(modelData, rawData);
            }
            catch (e) {
                getModelDataError.message = getModelDataError.message + " Error: " + e.message;
                throw getModelDataError;
            }
            model$ = Observable_1.Observable.of(model);
        }
        return entity.readonly ? model$.map(function (model) { return Object.freeze(model); }) : model$;
    };
    Repository.getSubModel = function (entityField, value, paris, config, options) {
        if (options === void 0) { options = data_options_1.defaultDataOptions; }
        var getPropertyEntityValue$;
        var mapValueToEntityFieldIndex = Repository.mapToEntityFieldIndex.bind(null, entityField.id);
        var repository = paris.getRepository(entityField.type);
        var valueObjectType = !repository && value_objects_service_1.valueObjectsService.getEntityByType(entityField.type);
        if (!repository && !valueObjectType)
            return null;
        var getItem = repository
            ? Repository.getEntityItem.bind(null, repository)
            : Repository.getValueObjectItem.bind(null, valueObjectType);
        if (entityField.isArray) {
            if (value.length) {
                var propertyMembers$ = value.map(function (memberData) { return getItem(memberData, options, paris, config); });
                getPropertyEntityValue$ = Observable_1.Observable.combineLatest.apply(Observable_1.Observable, propertyMembers$).map(mapValueToEntityFieldIndex);
            }
            else
                getPropertyEntityValue$ = Observable_1.Observable.of([]).map(mapValueToEntityFieldIndex);
        }
        else
            getPropertyEntityValue$ = getItem(value, options, paris, config)
                .map(mapValueToEntityFieldIndex);
        return getPropertyEntityValue$;
    };
    Repository.mapToEntityFieldIndex = function (entityFieldId, value) {
        var data = {};
        data[entityFieldId] = value;
        return data;
    };
    Repository.getEntityItem = function (repository, data, options) {
        if (options === void 0) { options = data_options_1.defaultDataOptions; }
        return Object(data) === data ? repository.createItem(data, options) : repository.getItemById(data, options);
    };
    Repository.getValueObjectItem = function (valueObjectType, data, options, paris, config) {
        if (options === void 0) { options = data_options_1.defaultDataOptions; }
        // If the value object is one of a list of values, just set it to the model
        if (valueObjectType.values)
            return Observable_1.Observable.of(valueObjectType.getValueById(data) || valueObjectType.getDefaultValue() || null);
        return Repository.getModelData(data, valueObjectType, config, paris, options);
    };
    Repository.prototype.query = function (query, dataOptions) {
        var _this = this;
        if (dataOptions === void 0) { dataOptions = data_options_1.defaultDataOptions; }
        var queryError = new Error("Failed to get " + this.entity.pluralName + ".");
        var httpOptions = this.entity.parseDataQuery ? { params: this.entity.parseDataQuery(query) } : dataset_service_1.DatasetService.queryToHttpOptions(query);
        return this.dataStore.get("" + this.endpointName + (this.entity.allItemsEndpointTrailingSlash !== false && !this.entity.allItemsEndpoint ? '/' : '') + (this.entity.allItemsEndpoint || ''), httpOptions, this.baseUrl)
            .map(function (rawDataSet) {
            var allItemsProperty = _this.entity.allItemsProperty || _this.config.allItemsProperty;
            var rawItems = rawDataSet instanceof Array ? rawDataSet : rawDataSet[allItemsProperty];
            if (!rawItems)
                errors_service_1.ErrorsService.warn("Property '" + _this.config.allItemsProperty + "' wasn't found in DataSet for Entity '" + _this.entity.pluralName + "'.");
            return {
                count: rawDataSet.count,
                items: rawItems,
                next: rawDataSet.next,
                previous: rawDataSet.previous
            };
        })
            .flatMap(function (dataSet) {
            var itemCreators = dataSet.items.map(function (itemData) { return _this.createItem(itemData, dataOptions); });
            return Observable_1.Observable.combineLatest.apply(_this, itemCreators).map(function (items) {
                return Object.freeze({
                    count: dataSet.count,
                    items: items,
                    next: dataSet.next,
                    previous: dataSet.previous
                });
            }).catch(function (error) {
                queryError.message = queryError.message + " Error: " + error.message;
                throw queryError;
            });
        });
    };
    Repository.prototype.getItemById = function (itemId, options, params) {
        var _this = this;
        if (options === void 0) { options = data_options_1.defaultDataOptions; }
        if (this.entity.values) {
            var entityValue = void 0;
            if (itemId !== null && itemId !== undefined) {
                if (this.entity.hasValue(itemId))
                    entityValue = this.entity.getValueById(itemId);
                else
                    errors_service_1.ErrorsService.warn("Unknown value for " + this.entity.singularName + ": ", itemId);
            }
            return Observable_1.Observable.of(entityValue || this.entity.getDefaultValue());
        }
        if (options.allowCache !== false && this.entity.cache)
            return this.cache.get(itemId);
        if (this.entity.loadAll)
            return this.setAllItems().map(function () { return _this._allValuesMap.get(String(itemId)); });
        else {
            return this.dataStore.get(this.entity.parseItemQuery ? this.entity.parseItemQuery(itemId, this.entity, this.config) : this.endpointName + "/" + itemId, params && { params: params }, this.baseUrl)
                .flatMap(function (data) { return _this.createItem(data, options); });
        }
    };
    Repository.prototype.setAllItems = function () {
        var _this = this;
        if (this._allValues)
            return Observable_1.Observable.of(this._allValues);
        return this.query().do(function (dataSet) {
            _this._allValues = dataSet.items;
            _this._allValuesMap = new Map();
            _this._allValues.forEach(function (value) { return _this._allValuesMap.set(String(value.id), value); });
        }).map(function (dataSet) { return dataSet.items; });
    };
    /**
     * Saves an entity to the server
     * @param {T} item
     * @returns {Observable<T extends EntityModelBase>}
     */
    Repository.prototype.save = function (item) {
        var _this = this;
        if (!this.entity.endpoint)
            throw new Error("Entity " + this.entity.entityConstructor.name + " can't be saved - it doesn't specify an endpoint.");
        var isNewItem = item.id === undefined;
        try {
            var saveData = this.serializeItem(item);
            return this.dataStore.save(this.endpointName + "/" + (item.id || ''), isNewItem ? "POST" : "PUT", { data: saveData }, this.baseUrl)
                .flatMap(function (savedItemData) { return _this.createItem(savedItemData); })
                .do(function (item) {
                if (_this._allValues) {
                    _this._allValues = _this._allValues.concat([item]);
                    _this._allItemsSubject$.next(_this._allValues);
                }
                _this._saveSubject$.next({ entity: _this.entityConstructor, newValue: item, isNew: isNewItem });
            });
        }
        catch (e) {
            return Observable_1.Observable.throw(e);
        }
    };
    /**
     * Saves multiple items to the server, all at once
     * @param {Array<T extends EntityModelBase>} items
     * @returns {Observable<Array<T extends EntityModelBase>>}
     */
    Repository.prototype.saveItems = function (items) {
        var _this = this;
        if (!this.entity.endpoint)
            throw new Error(this.entity.pluralName + " can't be saved - it doesn't specify an endpoint.");
        var newItems = { method: "POST", items: [] }, existingItems = { method: "PUT", items: [] };
        items.forEach(function (item) {
            (item.id === undefined ? newItems : existingItems).items.push(_this.serializeItem(item));
        });
        var saveItemsArray = [newItems, existingItems]
            .filter(function (saveItems) { return saveItems.items.length; })
            .map(function (saveItems) { return _this.doSaveItems(saveItems.items, saveItems.method); });
        return Observable_1.Observable.combineLatest.apply(this, saveItemsArray).map(function (savedItems) { return _.flatMap(savedItems); });
    };
    /**
     * Does the actual saving to server for a list of items.
     * @param {Array<any>} itemsData
     * @param {"PUT" | "POST"} method
     * @returns {Observable<Array<T extends EntityModelBase>>}
     */
    Repository.prototype.doSaveItems = function (itemsData, method) {
        var _this = this;
        return this.dataStore.save(this.endpointName + "/", method, { data: { items: itemsData } }, this.baseUrl)
            .flatMap(function (savedItemsData) {
            if (!savedItemsData)
                return Observable_1.Observable.of(null);
            var itemsData = savedItemsData instanceof Array ? savedItemsData : savedItemsData.items;
            var itemCreators = itemsData.map(function (savedItemData) { return _this.createItem(savedItemData); });
            return Observable_1.Observable.combineLatest.apply(_this, itemCreators);
        });
    };
    Repository.prototype.remove = function (items) {
        var _this = this;
        if (!items)
            throw new Error("No " + this.entity.pluralName.toLowerCase() + " specified for removing.");
        if (!(items instanceof Array))
            items = [items];
        if (!items.length)
            return Observable_1.Observable.of([]);
        if (!this.entity.endpoint)
            throw new Error("Entity " + this.entity.entityConstructor.name + " can't be deleted - it doesn't specify an endpoint.");
        try {
            return this.dataStore.delete(this.endpointName, { data: { ids: items.map(function (item) { return item.id; }) } }, this.baseUrl)
                .do(function () {
                if (_this._allValues) {
                    items.forEach(function (item) {
                        var itemIndex = _.findIndex(_this._allValues, function (_item) { return _item.id === item.id; });
                        if (~itemIndex)
                            _this._allValues.splice(itemIndex, 1);
                    });
                    _this._allItemsSubject$.next(_this._allValues);
                }
                _this._removeSubject$.next({ entity: _this.entityConstructor, items: items });
            }).map(function () { return items; });
        }
        catch (e) {
            return Observable_1.Observable.throw(e);
        }
    };
    /**
     * Validates that the specified item is valid, according to the requirements of the entity (or value object) it belongs to.
     * @param item
     * @param {EntityConfigBase} entity
     * @returns {boolean}
     */
    Repository.validateItem = function (item, entity) {
        entity.fields.forEach(function (entityField) {
            var itemFieldValue = item[entityField.id];
            if (entityField.required && (itemFieldValue === undefined || itemFieldValue === null))
                throw new Error("Missing value for field '" + entityField.id + "'");
        });
        return true;
    };
    /**
     * Creates a JSON object that can be saved to server, with the reverse logic of getItemModelData
     * @param {T} item
     * @returns {Index}
     */
    Repository.prototype.serializeItem = function (item) {
        Repository.validateItem(item, this.entity);
        return Repository.serializeItem(item, this.entity, this.paris);
    };
    /**
     * Serializes an object value
     * @param item
     * @returns {Index}
     */
    Repository.serializeItem = function (item, entity, paris) {
        Repository.validateItem(item, entity);
        var modelData = {};
        entity.fields.forEach(function (entityField) {
            var itemFieldValue = item[entityField.id], fieldRepository = paris.getRepository(entityField.type), fieldValueObjectType = !fieldRepository && value_objects_service_1.valueObjectsService.getEntityByType(entityField.type), isNilValue = itemFieldValue === undefined || itemFieldValue === null;
            var modelValue;
            if (entityField.serialize)
                modelValue = entityField.serialize(itemFieldValue);
            else if (entityField.isArray)
                modelValue = itemFieldValue ? itemFieldValue.map(function (element) { return Repository.serializeItem(element, fieldRepository ? fieldRepository.entity : fieldValueObjectType, paris); }) : null;
            else if (fieldRepository)
                modelValue = isNilValue ? fieldRepository.entity.getDefaultValue() || null : itemFieldValue.id;
            else if (fieldValueObjectType)
                modelValue = isNilValue ? fieldValueObjectType.getDefaultValue() || null : Repository.serializeItem(itemFieldValue, fieldValueObjectType, paris);
            else
                modelValue = data_transformers_service_1.DataTransformersService.serialize(entityField.type, itemFieldValue);
            var modelProperty = entityField.data
                ? entityField.data instanceof Array ? entityField.data[0] : entityField.data
                : entityField.id;
            modelData[modelProperty] = modelValue;
        });
        return modelData;
    };
    return Repository;
}());
exports.Repository = Repository;