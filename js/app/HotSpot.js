/**
 * Date: 7/6/2015
 * Time: 12:39 PM
 * Author Rumen Neshev (rumen.n@komero.net)
 */

Class("HotSpot", {
    isa : Point,

    has : {
        type : {
            is : "ro",
            required : true,
            init : null
        },

        liveStream : {
            is : "ro",
            init : null
        }
    },

    after : {
        init : function() {
            this.feature.hotspot=this;
            GUI.hotspotsLayer.getSource().addFeature(this.feature);
        }
    },

    methods : {
        onClick : function() {
            // for now only hotspots with attached live-stream can be clicked
            var isConsumed = false;

            if (this.liveStream) {
                GUI.showLiveStream(this.liveStream);
                // well this event should be consumed and not handled any more (like when clicked on another feature
                isConsumed = true;
            }

            return isConsumed
        }
    }
});