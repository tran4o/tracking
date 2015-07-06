/**
 * Date: 7/6/2015
 * Time: 12:39 PM
 * Author Rumen Neshev (rumen.n@komero.net)
 */

Class("HotSpot", {
    isa : Point,

    has : {
        type : {
            is : "rw",
            init : null
        }
    },

    after : {
        init : function() {
            this.feature.hotspot=this;
            GUI.hotspotsLayer.getSource().addFeature(this.feature);
        }
    }
});