(function() {
  var CouchDBSyncedObject, LocallySynced, Monitored, MonitoredArray, MonitoredObject, Notifier, RemotelySynced, Synced, SyncedObjectPool, clone, couch, monitor, syncedCopy;
  var __bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; }, __hasProp = Object.prototype.hasOwnProperty, __extends = function(child, parent) {
    for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; }
    function ctor() { this.constructor = child; }
    ctor.prototype = parent.prototype;
    child.prototype = new ctor;
    child.__super__ = parent.prototype;
    return child;
  };
  Notifier = require("notifier").Notifier;
  monitor = function(obj, extensible) {
    if (extensible == null) {
      extensible = false;
    }
    if (Object.prototype.toString.call(obj) === '[object Array]') {
      return new MonitoredArray(obj, extensible);
    } else if (typeof obj === "object") {
      return new MonitoredObject(obj, extensible);
    } else {
      throw new Error("Can only monitor objects and arrays, not " + (typeof obj));
    }
  };
  clone = function(obj) {
    var key, temp, value;
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }
    if (Object.prototype.toString.call(obj) === '[object Array]') {
      temp = [];
    } else {
      temp = obj.constructor();
    }
    for (key in obj) {
      value = obj[key];
      temp[key] = clone(obj[key]);
    }
    return temp;
  };
  syncedCopy = function(mSrc, extensible) {
    var synced;
    if (extensible == null) {
      extensible = false;
    }
    synced = new LocallySynced(mSrc, mSrc._extensible);
    return synced.obj._obj;
  };
  couch = function(key, db, callback) {
    return db.get(key, __bind(function(err, doc) {
      var mDoc;
      mDoc = monitor(doc, true);
      new CouchDBSyncedObject(mDoc, key, db);
      return callback(mDoc);
    }, this));
  };
  SyncedObjectPool = (function() {
    __extends(SyncedObjectPool, Notifier);
    function SyncedObjectPool(socket, role, id) {
      this.socket = socket;
      this.role = role;
      this.id = id != null ? id : 'syncedpool';
      SyncedObjectPool.__super__.constructor.call(this);
      this.objects = {};
      if (this.role === 'client') {
        socket.emit("sync:poolInit", {
          id: this.id
        });
      }
      socket.on("sync:create", __bind(function(data) {
        var mObj, _ref;
        if (data.poolId === this.id) {
          mObj = monitor(data.obj, (_ref = data.extensible) != null ? _ref : false);
          this.objects[data.objId] = new RemotelySynced(data.objId, mObj, this.socket);
          return this.notifyAll('create', {
            name: data.objId,
            obj: mObj
          });
        }
      }, this));
      socket.on("sync:change", __bind(function(data) {
        if (this.objects[data.id]) {
          return this.objects[data.id].updateTarget(data.path, data.action, data.value, data.transactionId);
        }
      }, this));
    }
    SyncedObjectPool.prototype.create = function(name, obj, extensible) {
      var mObj;
      if (extensible == null) {
        extensible = false;
      }
      if (obj instanceof Monitored) {
        mObj = obj;
      } else {
        mObj = monitor(obj, extensible);
      }
      this.objects[name] = new RemotelySynced(name, mObj, this.socket);
      this.socket.emit('sync:create', {
        poolId: this.id,
        objId: name,
        obj: mObj._obj,
        extensible: extensible
      });
      return mObj;
    };
    return SyncedObjectPool;
  })();
  Synced = (function() {
    __extends(Synced, Notifier);
    function Synced(src) {
      var handled;
      this.src = src;
      Synced.__super__.constructor.call(this);
      handled = {};
      this.src.addListener({
        change: __bind(function(data) {
          if (!handled[data.transactionId]) {
            handled[data.transactionId] = true;
            this.sourceChanged(data.path, data.action, data.value, data.transactionId);
            return this.notifyAll("change", data);
          }
        }, this)
      });
    }
    Synced.prototype.updateTarget = function(path, action, value, transactionId) {
      var target;
      if (transactionId == null) {
        transactionId = "id-" + Math.random;
      }
      target = this.obj;
      while (path.length > 1) {
        target = target[path.shift()];
      }
      switch (action) {
        case 'set':
          return target.setProperty(path.shift(), value, transactionId);
        case "delete":
          return target.deleteProperty(path.shift(), transactionId);
      }
    };
    return Synced;
  })();
  RemotelySynced = (function() {
    __extends(RemotelySynced, Synced);
    function RemotelySynced(id, obj, socket) {
      this.id = id;
      this.obj = obj;
      this.socket = socket;
      RemotelySynced.__super__.constructor.call(this, this.obj);
      this.handledRemoteTransactions = {};
    }
    RemotelySynced.prototype.sourceChanged = function(path, action, value, transactionId) {
      if (!this.handledRemoteTransactions[transactionId]) {
        return this.socket.emit("sync:change", {
          id: this.id,
          path: path,
          action: action,
          value: value,
          transactionId: transactionId
        });
      }
    };
    RemotelySynced.prototype.updateTarget = function(path, action, value, transactionId) {
      if (transactionId == null) {
        transactionId = "id-" + Math.random;
      }
      this.handledRemoteTransactions[transactionId] = true;
      return RemotelySynced.__super__.updateTarget.call(this, path, action, value, transactionId);
    };
    return RemotelySynced;
  })();
  CouchDBSyncedObject = (function() {
    __extends(CouchDBSyncedObject, Synced);
    function CouchDBSyncedObject(obj, key, db) {
      this.obj = obj;
      this.key = key;
      this.db = db;
      CouchDBSyncedObject.__super__.constructor.call(this, this.obj);
    }
    CouchDBSyncedObject.prototype.sourceChanged = function(path, action, value, transactionId) {
      if (path[0] !== '_rev') {
        return this.db.insert(this.obj._obj, this.key, __bind(function(err, d) {
          if (err) {
            return console.log(err);
          } else if (d.ok) {
            return this.obj.setProperty('_rev', d.rev);
          }
        }, this));
      }
    };
    return CouchDBSyncedObject;
  })();
  LocallySynced = (function() {
    __extends(LocallySynced, Synced);
    function LocallySynced(src, extensible) {
      this.src = src;
      if (extensible == null) {
        extensible = false;
      }
      LocallySynced.__super__.constructor.call(this, this.src);
      this.obj = monitor(clone(this.src['_obj']), extensible);
    }
    LocallySynced.prototype.sourceChanged = function(path, action, value, transactionId) {
      return this.updateTarget(path, action, value, transactionId);
    };
    return LocallySynced;
  })();
  Monitored = (function() {
    __extends(Monitored, Notifier);
    function Monitored(_obj, _extensible) {
      this._obj = _obj;
      this._extensible = _extensible != null ? _extensible : false;
      Monitored.__super__.constructor.call(this);
      this.__propertyListeners__ = {};
      this._transactionId = false;
    }
    Monitored.prototype._clearProperty = function(key) {
      delete this[key];
      if (this[key] instanceof Notifier) {
        this[key].removeListener(this.__propertyListeners__[key]);
        return delete this.__propertyListeners__[key];
      }
    };
    Monitored.prototype._notifyPropertyChange = function(key, value, transactionId) {
      if (transactionId == null) {
        transactionId = "id-" + Math.random();
      }
      this.notifyAll("set", {
        key: key,
        value: value,
        transactionId: transactionId
      });
      return this.notifyAll("change", {
        action: "set",
        path: [key],
        value: value,
        transactionId: transactionId
      });
    };
    Monitored.prototype.setProperty = function(key, value, transactionId) {
      if (transactionId == null) {
        transactionId = "id-" + Math.random();
      }
      if (this[key]) {
        this._clearProperty(key);
        this._obj[key] = value;
        this._monitorProperty(key, value);
        return this._notifyPropertyChange(key, value, transactionId);
      } else {
        if (!this._extensible) {
          throw new Error("Trying to extend a non-extensible object.");
        }
        this._obj[key] = value;
        this._monitorProperty(key, value);
        return this.notifyAll("change", {
          action: "set",
          path: [key],
          value: value,
          transactionId: transactionId
        });
      }
    };
    Monitored.prototype.deleteProperty = function(key, transactionId) {
      if (transactionId == null) {
        transactionId = "id-" + Math.random();
      }
      if (this[key]) {
        if (this[key] instanceof Notifier) {
          this[key].removeListener(this.__propertyListeners__[key]);
          delete this.__propertyListeners__[key];
        }
        delete this[key];
        delete this._obj[key];
        return this.notifyAll("change", {
          action: "delete",
          path: [key],
          transactionId: transactionId
        });
      }
    };
    Monitored.prototype._defineObjectProperty = function(key, value) {
      this[key] = monitor(value, this._extensible);
      return this.__propertyListeners__[key] = this[key].addListener({
        change: __bind(function(data) {
          var path;
          path = data.path.splice(0);
          path.unshift(key);
          return this.notifyAll("change", {
            action: "set",
            path: path,
            value: data.value,
            transactionId: data.transactionId
          });
        }, this)
      });
    };
    Monitored.prototype._monitorProperty = function(key, value) {
      if (value && typeof value === 'object') {
        return this._defineObjectProperty(key, value);
      } else {
        this.__defineGetter__(key, __bind(function() {
          return this._obj[key];
        }, this));
        return this.__defineSetter__(key, __bind(function(val) {
          if (!this._extensible) {
            throw new Error("Using asignment operator on non-extensible object, use set/deleteProperty() methods instead or enable object extensibility.");
          }
          this._notifyPropertyChange(key, val);
          this._obj[key] = val;
          this._clearProperty(key, val);
          if (typeof val === 'object') {
            this._defineObjectProperty(key, val);
            return this[key];
          } else {
            this.__defineGetter__(key, __bind(function() {
              return this._obj[key];
            }, this));
            return val;
          }
        }, this));
      }
    };
    return Monitored;
  })();
  MonitoredArray = (function() {
    __extends(MonitoredArray, Monitored);
    function MonitoredArray(_obj) {
      var arrayMethods, methodName, _fn, _i, _len;
      this._obj = _obj;
      MonitoredArray.__super__.constructor.call(this, this._obj, true);
      this.__defineGetter__('length', __bind(function() {
        return this._obj.length;
      }, this));
      this.__defineGetter__('index', __bind(function() {
        return this._obj.index;
      }, this));
      arrayMethods = ['concat', 'indexOf', 'join', 'pop', 'push', 'reverse', 'shift', 'slice', 'sort', 'splice', 'toString', 'unshift', 'valueOf', 'toSource', 'indexOf', 'filter', 'forEach', 'every', 'map', 'some', 'reduce', 'reduceRight'];
      _fn = __bind(function(methodName) {
        return this[methodName] = __bind(function() {
          var ret;
          ret = this._obj[methodName].apply(this._obj, arguments);
          this.notifyAll("methodCall", {
            methodName: methodName,
            args: arguments
          });
          return ret;
        }, this);
      }, this);
      for (_i = 0, _len = arrayMethods.length; _i < _len; _i++) {
        methodName = arrayMethods[_i];
        _fn(methodName);
      }
      this.addListener({
        methodCall: __bind(function(data) {
          switch (data.methodName) {
            case "push":
              return this.notifyAll("change", {
                path: [this._obj.length - 1],
                value: data.args[0],
                action: "set",
                transactionId: "id-push-" + Math.random()
              });
          }
        }, this)
      });
      this.__childMonitors = {};
      this._monitoredIndices = 0;
      this._updateIndices();
    }
    MonitoredArray.prototype._updateIndices = function() {
      var i, _fn, _ref, _ref2;
      _fn = __bind(function(i) {
        var value;
        value = this._obj[i];
        return this._monitorProperty(i, value);
      }, this);
      for (i = _ref = this._monitoredIndices, _ref2 = this._obj.length - 1; _ref <= _ref2 ? i <= _ref2 : i >= _ref2; _ref <= _ref2 ? i++ : i--) {
        _fn(i);
      }
      return this._monitoredIndices = this._obj.length - 1;
    };
    MonitoredArray.prototype.isArray = function() {
      return True;
    };
    return MonitoredArray;
  })();
  MonitoredObject = (function() {
    __extends(MonitoredObject, Monitored);
    function MonitoredObject(_obj, _extensible) {
      var key, value, _fn, _ref;
      this._obj = _obj;
      this._extensible = _extensible != null ? _extensible : false;
      MonitoredObject.__super__.constructor.call(this, this._obj, this._extensible);
      _ref = this._obj;
      _fn = __bind(function(key) {
        return this._monitorProperty(key, value);
      }, this);
      for (key in _ref) {
        if (!__hasProp.call(_ref, key)) continue;
        value = _ref[key];
        _fn(key);
      }
      if (!this._extensible) {
        Object.preventExtensions(this);
        Object.preventExtensions(this._obj);
      }
    }
    return MonitoredObject;
  })();
  exports = (typeof window === 'object'? window['monitor']={}: exports);
  exports.monitor = monitor;
  exports.syncedCopy = syncedCopy;
  exports.SyncedObjectPool = SyncedObjectPool;
  exports.CouchDBSyncedObject = CouchDBSyncedObject;
  exports.clone = clone;
  exports.couch = couch;
}).call(this);
