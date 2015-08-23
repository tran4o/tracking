module.exports = function (grunt) {
    // simple tasks not requiring any grunt-plugin
    grunt.registerTask("log-build-start", function() {
        console.log("Start building...");
    });
    grunt.registerTask("log-build-end", function() {
        console.log("Done building");
    });

    // define all the task that require a grunt-plugin
    grunt.initConfig({
        exec: {
            browserify_index: {
                command: 'browserify js\\app\\Index.js --debug >index.js'
            },

            browserify_admin: {
                command: 'browserify js\\app\\Admin.js --debug >js\\nodejs\\admin\\admin.js'
            },

            browserify_start: {
                command: 'browserify js\\app\\Starts.js --debug >js\\nodejs\\admin\\starts.js'
            }

        }
    });

    grunt.loadNpmTasks('grunt-exec');
    grunt.loadNpmTasks('grunt-wget');

    // this will be the default/normal grunt task
    grunt.registerTask("default", ["log-build-start",

        "exec:browserify_index", "exec:browserify_admin", "exec:browserify_start",

        "log-build-end"]);
};