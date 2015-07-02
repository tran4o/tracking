Class("LiveStream", {
    has : {
        _$comp : {
            init: function(config) {
                return $('#' + config.id);
            }
        }
    },
    methods: {
        show: function(streamId) {
            this._$comp.show();
        },

        hide : function() {
            this._$comp.hide();
        }
    }
});


Class("Stream", {


});