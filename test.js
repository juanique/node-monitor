(function() {
  var DummySocket, monitor, notifier, setup;
  var __hasProp = Object.prototype.hasOwnProperty, __extends = function(child, parent) {
    for (var key in parent) { if (__hasProp.call(parent, key)) child[key] = parent[key]; }
    function ctor() { this.constructor = child; }
    ctor.prototype = parent.prototype;
    child.prototype = new ctor;
    child.__super__ = parent.prototype;
    return child;
  }, __bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; };
  require.paths.unshift('.');
  monitor = require('./lib/monitor');
  notifier = require('notifier');
  DummySocket = (function() {
    __extends(DummySocket, notifier.Notifier);
    function DummySocket(name, otherEnd) {
      this.name = name;
      this.otherEnd = otherEnd != null ? otherEnd : false;
      DummySocket.__super__.constructor.call(this);
    }
    DummySocket.prototype.log = function(msg) {};
    DummySocket.prototype.emit = function(msg, data) {
      this.log("emit " + msg);
      return this.notifyAll("emit", {
        msg: msg,
        data: data
      });
    };
    DummySocket.prototype.on = function(msg, callback) {
      this.log("listening for " + msg);
      return this.otherEnd.addListener({
        emit: __bind(function(event) {
          if (event.msg === msg) {
            this.log("received " + event.msg);
            return callback(monitor.clone(event.data));
          }
        }, this)
      });
    };
    return DummySocket;
  })();
  setup = function(callback) {
    var poolClient, poolId, poolServer, s1, s2;
    poolId = 'clientId123';
    s1 = new DummySocket('server');
    s2 = new DummySocket('client', s1);
    s1.otherEnd = s2;
    poolServer = new monitor.SyncedObjectPool(s1, 'server', poolId);
    s1.on('sync:poolInit', function(data) {});
    poolClient = new monitor.SyncedObjectPool(s2, 'client', poolId);
    return callback([poolServer, poolClient]);
  };
  exports['TestSuite'] = function(test) {
    test.ok(true, "Test suite working.");
    return test.done();
  };
  exports['PoolConnection'] = function(test) {
    var listener, poolClient, poolId, poolServer, s1, s2;
    s1 = new DummySocket('server');
    s2 = new DummySocket('client', s1);
    s1.otherEnd = s2;
    poolServer = new monitor.SyncedObjectPool(s1, 'server');
    listener = s1.on('sync:poolInit', function(data) {
      test.equal(data.id, poolId, "Object pool id received.");
      return test.done();
    });
    poolId = 'clientId123';
    poolClient = new monitor.SyncedObjectPool(s2, 'client', poolId);
    return s2.removeListener(listener);
  };
  'exports[\'Couch\'] = (test) ->\n    nano = require(\'nano\')(\'http://127.0.0.1:5984\')\n    myVar = false\n    setup (data) ->\n        [poolServer, poolClient] = data\n\n        nano.db.destroy "test", (err, res, head) ->\n            console.log res\n            nano.db.create "test", ->\n                testdb = nano.use "test"\n\n                poolClient.addListener\n                    create: (data) ->\n                        [name, obj] = [data.name, data.obj]\n                        myVar = obj\n                        myVar.setProperty("a",6)\n\n                monitor.couch \'monitor-test\',testdb, (mDoc) ->\n                    poolServer.create \'myVar\', mDoc, true';
  exports['ObjectPool::create'] = function(test) {
    var clientMObj, obj, objName;
    obj = {
      workers: 1000
    };
    objName = "deathStar";
    clientMObj = false;
    return setup(function(data) {
      var mObj, poolClient, poolServer;
      poolServer = data[0], poolClient = data[1];
      poolClient.addListener({
        create: function(data) {
          test.equal(data.name, objName, "correct object name");
          test.deepEqual(data.obj._obj, obj, "correct obj");
          data.obj.setProperty("destroyed", true);
          test.ok(obj.destroyed);
          test.done();
          clientMObj = data.obj;
          return data.obj.addListener({
            change: function(data) {
              if (data.path[0] === "destroyedBy" && data.value === "Han Solo") {
                return test.ok(true);
              }
            }
          });
        }
      });
      mObj = poolServer.create(objName, obj, true);
      mObj.setProperty("destroyedBy", "Han Solo");
      test.notEqual(clientMObj.destroyedBy, void 0);
      mObj.deleteProperty("destroyedBy");
      return test.equal(clientMObj.destroyedBy, void 0);
    });
  };
  exports['Asignments'] = function(test) {
    var arr, mArr, mObj, obj, target;
    obj = {
      a: 1,
      b: 2,
      c: {
        w: {
          alpha: "a",
          beta: "b"
        },
        x: 'x',
        y: 'y',
        z: [1, 2, 3]
      }
    };
    arr = [1, 2, 3];
    mArr = monitor.monitor(arr, true);
    mObj = monitor.monitor(obj, true);
    target = monitor.syncedCopy(mObj);
    mObj.b = 5;
    test.equal(mObj.a, 1);
    test.equal(mObj.a, obj.a);
    test.equal(mObj.b, 5);
    test.equal(mObj.b, obj.b);
    test.equal(mArr[0], 1);
    mArr[0] = 2;
    test.equal(mArr[0], 2);
    test.equal(arr[0], 2);
    test.equal(mArr.length, 3);
    mArr.push(6);
    test.equal(mArr.length, 4);
    test.equal(mArr.pop(), 6);
    test.equal(mArr.length, 3);
    test.equal(mObj.c.x, 'x');
    mObj.c.x = 'z';
    test.equal(mObj.c.x, 'z');
    test.equal(mObj.c.x, obj.c.x);
    mObj.c.w.alpha = 'g';
    test.deepEqual(target, obj);
    return test.done();
  };
}).call(this);
