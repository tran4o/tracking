/**
 * Created by Rumen Neshev on 7/4/2015.
 */

Class("Point", {
    //--------------------------------------
    // ALL COORDINATES ARE IN WORLD MERCATOR
    //--------------------------------------

    has : {
        code : {
            is : "rw",
            init : "CODE_NOT_SET"
        },
        id : {
            is : "rw",
            init : "ID_NOT_SET"
        },
        feature : {
            is : "rw",
            init : null
        },
        position : {
            is:   "rw",
            init: [0,0]	//lon lat world mercator
        }
    },

    methods : {
        init : function(pos) {
            var geom = new ol.geom.Point(pos);
            geom.transform('EPSG:4326', 'EPSG:3857');
            var feature = new ol.Feature();
            feature.setGeometry(geom);
            this.setFeature(feature);
            this.setPosition(pos);
        }
    }
});