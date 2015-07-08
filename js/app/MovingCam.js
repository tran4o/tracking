/**
 * Date: 7/6/2015
 * Time: 3:02 PM
 * Author Rumen Neshev (rumen.n@komero.net)
 */

Class("MovingCam", {
    isa : Participant,

    override : {
        initFeature : function() {
            this.feature.cam=this;
            GUI.camsLayer.getSource().addFeature(this.feature);
        }
    }
});