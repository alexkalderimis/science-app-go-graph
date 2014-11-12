/*global Backbone */
/*global imjs */
/*global _ */
/*global DAGWidget */
/*global Promise */
/*defined verifyModel */
(function(window, $, Backbone, _, intermine, OntologyWidget, Promise, undefined) {
  'use strict';

  console.log('Hello, dag app!');

  //--- Initial state
  
  var States = {LOADED: 'loaded', ERROR: 'error', LOADING: 'loading', INIT: 'init'};
  var Data = Backbone.Model.extend({
    initialize: function () {
      this.set({state: States.INIT, error: new Message(), loading: new Message()});
    },
    setLoadingMessage: function (message) {
      this.set({state: States.LOADING, loading: new Message(message)});
    },
    setError: function (e) {
      this.set({state: States.ERROR, error: e});
    }
  });

  var $root = $('[data-app-name="dag-app"]');
  var url = 'https://apps.araport.org/thalemine/service';

  var data = new Data();
  var graph = new Backbone.Model({edges: [], nodes: []});
  var conn = intermine.Service.connect({root: url});

  var REQUIRED_PATHS = [
    'Gene.goAnnotation.ontologyTerm.identifier',
    'Gene.goAnnotation.ontologyTerm.parents.identifier',
    'OntologyRelation.childTerm.identifier',
    'OntologyRelation.parentTerm.identifier',
    'OntologyRelation.relationship',
    'OntologyRelation.direct',
    'OntologyTerm.identifier',
    'OntologyTerm.name'
  ];

  //--- Init checks

  var checkModel = conn.fetchModel().then(verifyModel(REQUIRED_PATHS));

  // --- UI controllers

  var Form = Backbone.View.extend({
    initialize: function () {
      this.listenTo(data, 'change:locus', this.setLocus);
    },

    events: {
      'change input[name="locus"]': 'changeLocus'
    },

    setLocus: function () {
      this.$('input[name="locus"]').val(data.get('locus'));
    },

    changeLocus: function (e) {
      data.set({locus: e.target.value});
    },

    render: function () {
    }
  });

  var errorTemplate = _.template('<div class="alert alert-warning"><strong>Error</strong> <%= error.message %></div>');
  var loadingTemplate = _.template('<div class="alert alert-info"><strong>Loading</strong> <%= loading.message %></div>');

  var OntologyView = Backbone.View.extend({
    initialize: function () {
      this.listenTo(graph, 'change', this.loadGraph);
      this.listenTo(data, 'change', this.render);
    },
    loadGraph: function () {
      if (this._widget && graph.has('nodes') && graph.has('edges')) {
        console.log('Setting graph', graph.toJSON());
        this._widget.setGraph(graph.toJSON());
      } else {
        console.log('Not setting graph');
      }
    },
    render: function () {
      var state = data.get('state');
      if (state === States.ERROR) {
        console.log('Rendering apology');
        this.$el.html(errorTemplate(data.toJSON()));
      } else if (state === States.LOADING) {
        console.log('Rendering loading notice');
        this.$el.html(loadingTemplate(data.toJSON()));
      } else if (state === States.LOADED) {
        console.log('Rendering DAG');
        if (!this._widget) {
          this._widget = createDagWidget(this.el);
          console.log(this._widget);
        }
        this.loadGraph();
        try {
          this._widget.render();
        } catch (e) {
          console.log(e.stack);
          data.setError(e);
        }
      }
    }
  });

  // --- MAIN

  main('AT4G19020');

  function main (locus) {

    var form = new Form();
    form.setElement($root.find('.user-input')[0]);

    var ontology = new OntologyView();
    ontology.setElement($root.find('.dag')[0]);
    ontology.render();

    data.on('change:locus', function () {
      data.set({state: 'fetching'});

      checkModel.then(fetchData).then(onSuccess).then(null, onError);

      function onSuccess (g) {
        console.log('Got graph:', g);
        graph.set(g);
        data.set({state: States.LOADED});
      }
      function onError (e) {
        data.setError(e);
      }
    });

    data.set({locus: locus});
  }

  //----- function defintions.

  function fetchData () {
    var locus = data.get('locus');
    data.setLoadingMessage('ontology terms');
    // Get all the GO identifiers for a Gene - flattened.
    var getPairs = conn.rows(termQuery(locus));
    var getIsDirect = getPairs.then(buildIsDirect);
    var getTerms = getPairs.then(_.flatten).then(_.unique);

    data.setLoadingMessage('edges');
    var getEdges = getTerms.then(edgeQuery).then(conn.records);
    var getNodes = when([getTerms, getIsDirect]).then(function (args) {
      data.setLoadingMessage('nodes');
      var ids = args[0];
      var isDirect = args[1];
      return conn.records(nodeQuery(ids)).then(setBool('direct', isDirect));
    });
    return when([getEdges, getNodes]).then(function (args) {
      return {edges: args[0], nodes: args[1]};
    });
  }
  function termQuery (locus) {
    return {
      from: 'Gene',
      select: [
        'goAnnotation.ontologyTerm.identifier',
        'goAnnotation.ontologyTerm.parents.identifier'
      ],
      where: [['Gene', 'lookup', locus]]
    };
  }

  function when (promises) {
    return Promise.all(promises);
  }
  function edgeQuery (identifiers) {
    return {
      name: 'edge-query',
      from: 'OntologyRelation',
      select: [
        'childTerm.identifier',
        'relationship',
        'parentTerm.identifier'
      ],
      where: {
        'childTerm.identifier': identifiers,
        'direct': 'true'
      }
    };
  }
  function nodeQuery (identifiers) {
    return {
      name: 'node-query',
      from: 'OntologyTerm',
      select: ['identifier', 'name'],
      where: {identifier: identifiers}
    };
  }
  function buildIsDirect (pairs) {
    var index = _.indexBy(pairs.map(_.first));
    return function (key) { return !!index[key]; };
  }
  function cssify (str) {
    return String(str).toLowerCase().replace(/[^a-z-]/g, '-');
  }
  function setBool (prop, test) {
    return function (things) {
      _.each(things, function (t) {
        t[prop] = test(t);
      });
      return things;
    };
  }
  function verifyModel (paths) {
    return function (model) {
      _.each(paths, function (path) {
        model.makePath(path);
      });
    };
  }
  function getIdentifier (o) { return o.identifier; }
  function getNodeClass (node) { return node.get('direct') ? 'direct' : 'inferred'; }
  function getEdgeClass (edge) { return cssify(edge.get('relationship')); }
  function onNodeClick (nid) {
    /*jshint validthis:true */
    var widget = this;
    return widget.zoomTo(nid);
  }
  function onEdgeClick (g, eid) {
    /*jshint validthis:true */
    var widget = this;
    widget.zoomTo(g.source(eid));
    setTimeout(function () { widget.zoomTo(g.target(eid)); }, 770);
  }
  function createDagWidget (el) {
    var opts = {
      rankScale: [0.95, 0.8],
      edgeLabels: ['relationship'],
      edgeProps: ['childTerm', 'parentTerm'],
      nodeKey: getIdentifier,
      onNodeClick: onNodeClick,
      getEdgeClass: getEdgeClass,
      getNodeClass: getNodeClass,
      onEdgeClick: onEdgeClick
    };
    var w = new OntologyWidget(opts);
    w.setElement(el);
    return w;
  }
  function Message (message) {
    this.message = message;
  }

})(window, jQuery, Backbone, _, imjs, DAGWidget, Promise);
