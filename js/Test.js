var RBTree = require('bintrees').RBTree;

var tree = new RBTree(function(a, b) { return a - b; });

tree.insert(1);
tree.insert(5);
tree.insert(7);
tree.insert(11);
tree.insert(22);
tree.insert(100);



var it = tree.lowerBound(99);

console.log(it.data());
console.log(it.prev());


//LOERBOUND = 
//MAX >= 
