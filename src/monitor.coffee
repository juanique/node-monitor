# The **monitor** module provides tools to monitor object changes and allow 
# synchronization between different data sources.
#

# It makes use of the **notifier** module for event handling.
Notifier = require("notifier").Notifier

#### `monitor(obj, extensible)`
#Is the basic object monitor function. It wraps a given object to monitor its changes.
#Objects can be declared as extensibles, meaning that new properties *can* me added to 
#the object, or non-extensibles. Note that assigning new properties using the 
#`=` operator on a non-extensible object will *not* change the object nor the
#wrapper but it will not produce an error.
#
#       obj = { name: 'lion', type: 'animal' }
#       #mObj as in 'monitored object'
#       mObj = monitor obj
#       mObj.addListener
#           change: (event) ->
#               console.log "The #{event.path} property was 
#                            changed to #{event.value}!"
#
#       # The *change* event will be triggered.
#       mObj.name = 'zebra' 
monitor = (obj, extensible = false) ->
    #It will use an appropiate wrapper based on the object type.
    if Object.prototype.toString.call(obj)  == '[object Array]'
        #It could be an array.
        return new MonitoredArray(obj,extensible)
    else if typeof(obj) == "object"
        #Or a standard object.
        return new MonitoredObject(obj,extensible)
    else
        #It should only be called on non-primitive types. Other types are not supported.
        throw new Error "Can only monitor objects and arrays, not #{typeof obj}"

#### `clone(obj)`
#Simple object cloning function.
clone = (obj) ->
    if obj == null or typeof obj != 'object'
        return obj
    if Object.prototype.toString.call(obj)  == '[object Array]'
        temp = []
    else
        temp = obj.constructor()

    for key, value of obj
        temp[key] = clone(obj[key])
    return temp

#### `syncedCopy(obj, extensible)`
#Produces a synchronized copy of a monitored object. Changes to the source object
#changes to the source object will be synchronized to the copy.
#
#       person = { name: 'Juan', type: 'Programmer' }
#       mPerson = monitor person
#       personCopy = syncedCopy(mPerson)
#       mPerson.type = 'Developer'
#       assert.deepEqual(personCopy.type, 'Developer')
syncedCopy = (mSrc, extensible=false) ->
    synced = new LocallySynced(mSrc, mSrc._extensible)
    return synced.obj._obj


#### `couch(key, db, callback)`
#Obtains a monitored object whose changes are synchronized to a couchdb document.
#It was written based on the *nano* couchdb module for nodejs.
couch = (key, db, callback) ->
    db.get key, (err, doc) =>
        mDoc = monitor(doc, true)
        new CouchDBSyncedObject(mDoc, key, db)
        callback(mDoc)

#### SyncedObjectPool
#The `SyncedObjectPool` objects provide an interface to synchronize objects over
#a websocket. It requires both ends to instance a `SyncedObjectPool` server and
#client respectively.

#Server side
#
#       serverPool = new monitor.SyncedObjectPool(socket,'server')
#       socket.on 'sync:poolInit', (data) ->
#           serverPants = serverPool.create 'sharedPants',
#               color: 'white'
#           serverPants.addListener
#               change: (event) ->
#                   console.log "The pants have changed."
#
#Client side
#
#       sharedVars = {}
#       clientPool = new monitor.SyncedObjectPool(socket,'client')
#       clientPool.addListener
#           create : (event) ->
#               sharedVars[event.name] = event.obj
#               event.obj.color = 'blue'
#
class SyncedObjectPool extends Notifier

    constructor: (@socket, @role, @id='syncedpool') ->
        super()
        @objects = {}
        if @role == 'client'
            socket.emit "sync:poolInit",
                id: @id

        socket.on "sync:create", (data) =>
            if data.poolId == @id
                mObj = monitor(data.obj, data.extensible ? false)
                @objects[data.objId] = new RemotelySynced(data.objId, mObj, @socket)
                @notifyAll 'create', {name: data.objId, obj: mObj}


        socket.on "sync:change", (data) =>
            if @objects[data.id]
                @objects[data.id].updateTarget(data.path,data.action, data.value, data.transactionId)

    create: (name,obj, extensible = false) ->
        if obj instanceof Monitored
            mObj = obj
        else
            mObj = monitor(obj, extensible)
        @objects[name] = new RemotelySynced(name, mObj, @socket)

        @socket.emit 'sync:create',
            poolId: @id
            objId: name
            obj: mObj._obj
            extensible: extensible

        return mObj
    

#### Synced
#Common superclass for synchronized objects.
class Synced extends Notifier
    constructor: (@src) ->
        super()
        handled = {}
        @src.addListener
            change : (data) =>
                if not handled[data.transactionId]
                    handled[data.transactionId] = true
                    @sourceChanged(data.path, data.action, data.value, data.transactionId)
                    @notifyAll "change", data

    updateTarget : (path, action, value, transactionId="id-"+Math.random) ->
        target = @obj
        while path.length > 1
            target = target[path.shift()]

        switch action
            when 'set' then target.setProperty(path.shift(),
                value, transactionId)
            when "delete" then target.deleteProperty(path.shift(), transactionId)


#### RemotelySynced
# Class to handle synchronization over websockets, `RemotelySynced` objects are instanciated
# from a `SyncedObjectPool`.
class RemotelySynced extends Synced
    constructor: (@id, @obj, @socket) ->
        super(@obj)
        @handledRemoteTransactions = {}

    sourceChanged: (path, action, value, transactionId) ->
        if not @handledRemoteTransactions[transactionId]
            @socket.emit "sync:change",
                id: @id
                path: path
                action: action
                value: value
                transactionId: transactionId

    updateTarget : (path, action, value, transactionId="id-"+Math.random) ->
        @handledRemoteTransactions[transactionId] = true
        super(path, action, value, transactionId)

#### CouchDBSyncedObject
# Class to handle synchronization with couchdb documents. These are created using the `couch` function
class CouchDBSyncedObject extends Synced
    constructor: (@obj, @key, @db) ->
        super(@obj)

    sourceChanged: (path, action, value, transactionId) ->
        if path[0] != '_rev'
            @db.insert @obj._obj, @key, (err, d) =>
                if err
                    console.log err
                else if d.ok
                    @obj.setProperty('_rev',d.rev)



#### LocallySynced
# Class to handle synchronization between two local varialbes. Used by the `syncCopy` function
class LocallySynced extends Synced
    constructor: (@src, extensible=false)->
        super(@src)
        @obj = monitor(clone(@src['_obj']), extensible)

    sourceChanged: (path,action, value, transactionId) ->
        @updateTarget(path, action, value, transactionId)


#### Monitored
#Base class for monitored objects. These are usually instanciated using the `monitor` helper
#function.
class Monitored extends Notifier
    constructor: (@_obj, @_extensible = false)->
        super()
        @__propertyListeners__ = {}
        @_transactionId = false


    _clearProperty : (key) ->
        delete @[key]
        if @[key] instanceof Notifier
            @[key].removeListener @__propertyListeners__[key]
            delete @__propertyListeners__[key]

    _notifyPropertyChange : (key, value, transactionId="id-"+Math.random()) ->
        @notifyAll "set",
            key: key
            value: value
            transactionId: transactionId
        @notifyAll "change",
            action: "set"
            path: [key]
            value: value
            transactionId: transactionId

    setProperty : (key, value, transactionId="id-"+Math.random()) ->
        if @[key]
            @_clearProperty(key)
            @_obj[key] = value
            @_monitorProperty(key,value)
            @_notifyPropertyChange(key,value, transactionId)
        else
            if not @_extensible
                throw new Error "Trying to extend a non-extensible object."

            @_obj[key] = value
            @_monitorProperty(key,value)
            @notifyAll "change",
                action: "set"
                path: [key]
                value: value
                transactionId: transactionId

    deleteProperty : (key, transactionId="id-"+Math.random()) ->
        if @[key]
            if @[key] instanceof Notifier
                @[key].removeListener @__propertyListeners__[key]
                delete @__propertyListeners__[key]

            delete @[key]
            delete @_obj[key]
            @notifyAll "change",
                action: "delete"
                path: [key]
                transactionId: transactionId


    _defineObjectProperty : (key, value) ->
        @[key] = monitor(value, @_extensible)
        @__propertyListeners__[key] = @[key].addListener
            change: (data) =>
                path = data.path.splice(0)
                path.unshift(key)
                @notifyAll "change",
                    action: "set"
                    path : path
                    value: data.value
                    transactionId: data.transactionId

    _monitorProperty: (key, value) ->
        if value and typeof value =='object'
            @_defineObjectProperty(key, value)
        else
            @__defineGetter__ key, =>
                return @_obj[key]

            @__defineSetter__ key, (val) =>
                if not @_extensible
                    throw new Error "Using asignment operator on non-extensible object, use set/deleteProperty() methods instead or enable object extensibility."

                @_notifyPropertyChange(key,val)
                @_obj[key] = val
                @_clearProperty(key, val)

                if typeof val =='object'
                    @_defineObjectProperty(key, val)
                    return @[key]
                else
                    @__defineGetter__ key, =>
                        return @_obj[key]
                    return val

#### MonitoredArray
#Wrapper class to handle array monitoring.
class MonitoredArray extends Monitored

    constructor: (@_obj) ->
        super @_obj, true
        @__defineGetter__ 'length', => return @_obj.length
        @__defineGetter__ 'index', => return @_obj.index

        arrayMethods = ['concat', 'indexOf', 'join', 'pop', 'push', 'reverse',
                        'shift', 'slice', 'sort', 'splice', 'toString', 'unshift',
                        'valueOf', 'toSource', 'indexOf', 'filter', 'forEach',
                        'every','map','some','reduce','reduceRight']

        for methodName in arrayMethods
            do (methodName) =>
                @[methodName] = =>
                    ret = @_obj[methodName].apply @_obj, arguments

                    @notifyAll "methodCall",
                        methodName: methodName
                        args: arguments

                    return ret

        @addListener
            methodCall: (data) =>
                switch data.methodName
                    when "push" then @notifyAll "change",
                        path: [@_obj.length-1]
                        value: data.args[0]
                        action: "set"
                        transactionId: "id-push-"+Math.random()

        @__childMonitors = {}
        @_monitoredIndices = 0
        @_updateIndices()

    _updateIndices: ->
        for i in [@_monitoredIndices..@_obj.length-1]
            do (i) =>
                value = @_obj[i]
                @_monitorProperty(i,value)

        @_monitoredIndices = @_obj.length-1

    isArray: -> return True

#### MonitoredObject
#Class to handle generic obect monitoring.
class MonitoredObject extends Monitored

    constructor: (@_obj, @_extensible=false) ->
        super @_obj, @_extensible
        for own key, value of @_obj
            do (key) =>
                @_monitorProperty key,value

        if not @_extensible
            Object.preventExtensions @
            Object.preventExtensions @_obj

`exports = (typeof window === 'object'? window['monitor']={}: exports)`
exports.monitor = monitor
exports.syncedCopy = syncedCopy
exports.SyncedObjectPool = SyncedObjectPool
exports.CouchDBSyncedObject = CouchDBSyncedObject
exports.clone = clone
exports.couch = couch
