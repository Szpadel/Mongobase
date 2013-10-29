'use strict'

function MongobaseEventDispatcher() {
    this._callbacks = {
        value: [],
        child_added: [],
        child_removed: [],
        child_changed: [],
        child_moved: []
    };

    this._callbacksOnce = {
        value: [],
        child_added: [],
        child_removed: [],
        child_changed: [],
        child_moved: []
    };
}

MongobaseEventDispatcher.prototype = {
    registerEvent: function(eventType, callback, cancelCallback, context) {
        this._callbacks[eventType].push({ callback: callback, cancelCallback: cancelCallback, context: context});
        return callback;
    },

    unregisterEvent: function(eventType, callback, context) {
        this._callbacks[eventType] = this._callbacks[eventType].filter(function(element) {
            return !(element.callback == callback && element.context == context);

        });
    },

    fireEvent: function(eventType, args) {
        for(var x in this._callbacks[eventType]) {
            var item = this._callbacks[eventType][x];
            item.callback.apply(item.context, args)
        }
        for(var x in this._callbacksOnce[eventType]) {
            var item = this._callbacksOnce[eventType][x];
            item.callback.apply(item.context, args)
            this._callbacksOnce.splice(x, 1);
        }
    }
};

// TODO: handle events from server
// TODO: initialize data from server
function MongobaseConnection(baseurl) {
    this.rootNode;
    this.socket = io.connect(baseurl);
    this.eventDispatchers = {};
}

MongobaseConnection.connections = {};

MongobaseConnection.getConnection = function(baseurl) {
    if(typeof this.connections[baseurl] === 'undefined') {
        this.connections[baseurl] = new MongobaseConnection(baseurl);
    }
};

MongobaseConnection.prototype = {
    createNodeTree: function(name, object) {
        var tree;
        var tObject = typeof object;
        if(tObject === "object") {
            tree = new MongobaseDataNode(name);
            for(var childName in object) {
                tree.addChild(this.createNodeTree(childName, object[childName]));
            }
        }else {
            tree = new MongobaseDataLeaf(name, object);
        }
        return tree;
    },

    connectEventsAtPath: function(path, eventDispatcher) {
        this.eventDispatchers[path] = eventDispatcher;
    },

    getProtectedPathes: function() {
        var paths = [];
        for(var path in this.connections) {
            paths.push(path);
        }
        return paths;
    },

    emit: function(event, data) {
        this._socket.emit(event, data);
    }
};

function MongobaseDataNode(name) {
    this.name = (name) ? name : this._genRandomName();
    this.childs = {};
    this.ref;
}

MongobaseDataNode.prototype = {
    _genRandomName: function() {
        var chars = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz'.split('');
        var uuid = [];
        var i;

        for (i = 0; i < 20; i++) uuid[i] = chars[0 | Math.random()*64];

        return uuid.join('');
    },

    addChild: function(childObj) {
        this.childs[childObj.name] = childObj;
    },

    // this could be done better
    getLastChildName: function() {
        var lastName;
        for(var x in this.childs) {
            lastName = x;
        }
        return lastName;
    },

    getNameBefore: function(name) {
        var lastName = null;
        for(var x in this.childs) {
            if(x === name) {
                return lastName;
            }
            lastName = x;
        }
    }
};

function MongobaseDataLeaf(name, value) {
    this.name = name;
    this.value = value;
}

function MongobaseRef() {
    this._socket;
    this._path;
    this._basename;
    this._eventDispatcher;
    this._node;

    // check if it is internal copy call
    if(arguments[0] instanceof MongobaseRef) {
        var orginal = arguments[0];
        this._socket = orginal._socket;
        this._basename = orginal._basename;
        this._path = arguments[1];
        this._node = arguments[2];
        this._eventDispatcher = new MongobaseEventDispatcher();
        this._socket.connectEventsAtPath(this._path, this._eventDispatcher);
    }else {
        // normal user call
        var url = arguments[0];

        // parse url, separate baseurl and resource _path
        var parser = document.createElement('a');
        parser.href = url;

        this._basename = parser.protocol + "://" + parser.host;

        // connect to server
        this._socket = MongobaseConnection.getConnection(this._basename);

        this._path = this._rebuildPath(parser.pathname);

        this._eventDispatcher = new MongobaseEventDispatcher();
        this._socket.connectEventsAtPath(this._path, this._eventDispatcher);
        // TODO: _node set from server by socket
    }
}

MongobaseRef.prototype = {
    _rebuildPath: function(rawPath) {
        var path = "";
        // get rid of empty elements (i.e for /user//fred or /user/fred/)
        var pathArray = rawPath.split('/');
        for(var x in pathArray) {
            if(pathArray[x] != "") {
                path += "/" + pathArray[x];
            }
        }
        return path;
    },

    auth: function() {
        alert("MongobaseRef#auth not implemented");
    },

    unauth: function() {
        alert("MongobaseRef#unauth not implemented")
    },

    // FIXME: ref in DataNode, third argument: node
    child: function(childPath) {
        childPath = this._rebuildPath(childPath);

        return new MongobaseRef(this, this._path + '/' + childPath);
    },

    // FIXME: ref in DataNode, third argument: node
    parent: function() {
        if(this._path == '/') {
            return null;
        }
        var pathArray = this._path.split('/');
        var parentPath = "";
        for(var a = 0; a < pathArray.length - 1; a++) {
            parentPath += pathArray[a];
        }

        return new MongobaseRef(this, parentPath);
    },

    // FIXME: ref in DataNode, third argument: node
    root: function() {
        return new MongobaseRef(this, "/");
    },

    name: function() {
        if(this._path == "/") {
            return null;
        }

        var pathArray = this._path.split('/');
        return pathArray[pathArray.length - 1];
    },

    toString: function() {
        return this._basename + this._path;
    },

    set: function(value, onComplete) {
        var events = [];
        if(typeof value == "object") {
            for(var x in value) {
                var tOf = typeof value[x];
                if(typeof this._node.childs[x] === "undefined") {
                    this._node.addChild(this._socket.createNodeTree(x, value[x]));
                    events.push(new MongobaseEvent("child_added", value[x], x, this._node.getLastChildName()));
                }else if(this._node[x] instanceof MongobaseDataNode || tOf === "object") {
                    var prevName = this._node.getNameBefore(x);
                    this._node.childs[x] = this._socket.createNodeTree(x, value[x]);
                    events.push(new MongobaseEvent("child_changed", value[x]), x, prevName);
                }else if(this._node[x] instanceof MongobaseDataLeaf) {
                    this._node.value = value[x];
                }
            }
        }else {
            console.error(this._path + ": sets value is not object - not supported yet");
        }
        events.push(new MongobaseEvent("value"), value, this._name);
        var _this = this;
        setTimeout(function() {
            for(var x in events) {
                _this._eventDispatcher.fireEvent(events[x].event, [
                    events[x].data, events[x].name, events[x].oldName ]);
            }
        }, 0);
    }
};

function MongobaseEvent(eventName, data, name, oldName) {
    this.data = data;
    this.event = eventName;
    this.name = name;
    this.oldName = oldName;
}

function MongobaseData(path, data, ref) {
    this._data = data;
    this._path = path;
    this._pathArray = path.split('/');
    this._baseRef = ref;
}

MongobaseData.prototype = {
    val: function() {
        return this._data;
    },

    // FIXME: ref in DataNode
    child: function(childPath) {
        childPath = this._baseRef._rebuildPath(childPath);

        // search for child _data
        var childData = this._data;
        for(var p in this._pathArray) {
            if(typeof this._data[p] == "undefined") {
                childData = null;
                break;
            }
            childData = childData[p];
        }

        // create child MongobaseData
        return new MongobaseData(this._path + '/' + childPath, childData, this._baseRef.child(childPath));
    },

    forEach: function() {
        alert("MongobaseData#forEach not implemented");
    },

    hasChild: function() {
        alert("MongobaseData#hasChild not implemented");
    },

    hasChildred: function() {
        alert("MongobaseData#hasChildred not implemented");
    },

    name: function() {

        if(this._pathArray.length == 0) { // check for root element
            return null;
        }

        // return last element of _path
        return this._pathArray[this._pathArray.length - 1];
    },

    numChildren: function() {
        alert("MongobaseData#numChildren not implemented");
    },

    ref: function() {
        return this._baseRef;
    },

    getPriority: function() {
        alert("MongobaseData#getPriority not implemented");
    },

    exportVal: function() {
        // create copy of _data
        return this._data.slice(0);
    }
};