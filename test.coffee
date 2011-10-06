require.paths.unshift('.')
monitor = require('./lib/monitor')
notifier = require('notifier')

#socket emulator

class DummySocket extends notifier.Notifier
    constructor : (@name,@otherEnd = false) ->
        super()


    log: (msg) ->
        #console.log "#{@name} \t: #{msg}"

    emit: (msg, data) ->
        @log "emit "+msg
        #console.log data
        @notifyAll "emit",
            msg: msg
            data: data

    on: (msg, callback) ->
        @log "listening for "+msg
        return @otherEnd.addListener
            emit: (event) =>
                if event.msg is msg
                    @log "received "+event.msg
                    callback(monitor.clone(event.data))



#Remotely synced
setup = (callback) ->
    poolId = 'clientId123'

    s1 = new DummySocket('server')
    s2 = new DummySocket('client',s1)
    s1.otherEnd = s2
    #serverSetup
    poolServer = new monitor.SyncedObjectPool(s1,'server', poolId)
    s1.on 'sync:poolInit', (data) ->

    #clientSetup
    poolClient = new monitor.SyncedObjectPool(s2,'client', poolId)
    callback([poolServer, poolClient])

exports['TestSuite'] = (test) ->
    test.ok(true,"Test suite working.")
    test.done()

exports['PoolConnection'] = (test) ->
    #sockets
    s1 = new DummySocket('server')
    s2 = new DummySocket('client',s1)
    s1.otherEnd = s2

    #serverSetup
    poolServer = new monitor.SyncedObjectPool(s1,'server')
    listener = s1.on 'sync:poolInit', (data) ->
        test.equal data.id, poolId, "Object pool id received."
        test.done()

    #clientSetup
    poolId = 'clientId123'
    poolClient = new monitor.SyncedObjectPool(s2,'client', poolId)

    #cleanup
    s2.removeListener(listener)

'''
exports['Couch'] = (test) ->
    nano = require('nano')('http://127.0.0.1:5984')
    myVar = false
    setup (data) ->
        [poolServer, poolClient] = data

        nano.db.destroy "test", (err, res, head) ->
            console.log res
            nano.db.create "test", ->
                testdb = nano.use "test"

                poolClient.addListener
                    create: (data) ->
                        [name, obj] = [data.name, data.obj]
                        myVar = obj
                        myVar.setProperty("a",6)

                monitor.couch 'monitor-test',testdb, (mDoc) ->
                    poolServer.create 'myVar', mDoc, true
'''



exports['ObjectPool::create'] = (test) ->
    obj = { workers: 1000 }
    objName = "deathStar"
    clientMObj = false

    setup (data) ->
        [poolServer, poolClient] = data
        poolClient.addListener
            create: (data) ->
                test.equal data.name, objName, "correct object name"
                test.deepEqual data.obj._obj, obj, "correct obj"
                data.obj.setProperty("destroyed", true)
                test.ok(obj.destroyed)
                test.done()
                clientMObj = data.obj

                data.obj.addListener
                    change: (data) ->
                        if data.path[0] == "destroyedBy" and data.value == "Han Solo"
                            test.ok(true)


        mObj = poolServer.create objName, obj, true
        mObj.setProperty("destroyedBy","Han Solo")
        test.notEqual(clientMObj.destroyedBy, undefined)
        mObj.deleteProperty("destroyedBy")
        test.equal(clientMObj.destroyedBy, undefined)


#unit tests
exports['Asignments'] = (test) ->
    obj =
        a: 1
        b: 2
        c:
            w:
                alpha: "a"
                beta: "b"
            x: 'x'
            y: 'y'
            z: [1,2,3]

    arr = [1,2,3]

    mArr = monitor.monitor(arr, true)
    mObj = monitor.monitor(obj, true)

    target = monitor.syncedCopy(mObj)

    #tests
    mObj.b = 5
    test.equal(mObj.a, 1)
    test.equal(mObj.a, obj.a)
    test.equal(mObj.b, 5)
    test.equal(mObj.b, obj.b)

    test.equal(mArr[0], 1)
    mArr[0] = 2
    test.equal(mArr[0], 2)
    test.equal(arr[0], 2)
    test.equal(mArr.length, 3)
    mArr.push(6)
    test.equal(mArr.length, 4)
    test.equal(mArr.pop(), 6)
    test.equal(mArr.length, 3)

    #nested obj
    test.equal(mObj.c.x, 'x')
    mObj.c.x = 'z'
    test.equal(mObj.c.x, 'z')
    test.equal(mObj.c.x, obj.c.x)
    mObj.c.w.alpha = 'g'

    #sync
    test.deepEqual(target, obj)

    test.done()
