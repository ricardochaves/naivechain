'use strict';
var CryptoJS = require("crypto-js");
var express = require("express");
var bodyParser = require('body-parser');
var WebSocket = require("ws");

//Iniciando as variáveis de porta do http, p2p e peers
var http_port = process.env.HTTP_PORT || 3001;
var p2p_port = process.env.P2P_PORT || 6001;
var initialPeers = process.env.PEERS ? process.env.PEERS.split(',') : [];

//Criando a classe Block
class Block {
    constructor(index, previousHash, timestamp, data, hash) {
        this.index = index; //Pk
        this.previousHash = previousHash.toString(); //Hash anterior
        this.timestamp = timestamp;
        this.data = data;
        this.hash = hash.toString(); //Hash do bloco
    }
}

var sockets = []; //para o websocket 
var MessageType = {
    QUERY_LATEST: 0,
    QUERY_ALL: 1,
    RESPONSE_BLOCKCHAIN: 2
}; //tipando as mensagens

//Pega o bloco genesis, todos blockchain deve ter um bloco inicial
// esse bloco inicial chama genesis.
var getGenesisBlock = () => {
    return new Block(0, "0", 1465154705, "my genesis block!!", "816534932c2b7154836da6afc367695e6337db8a921823784c14378abed4f7d7");
};

//Aqui é uma simulação do banco de dados, será apenas um array in memory
var blockchain = [getGenesisBlock()];

//Variável que vai iniciar o Servidor Http.
var initHttpServer = () => {
    var app = express();
    app.use(bodyParser.json());

    // Essa roda pega o banco de dados e retorna, nada de mais aqui.
    app.get('/blocks', (req, res) => res.send(JSON.stringify(blockchain)));
    
    //Aqui você vai incluir um novo bloco no seu blockchain
    app.post('/mineBlock', (req, res) => {
        //Você envia os dados do bloco, o sevidor gera o bloco para você.
        var newBlock = generateNextBlock(req.body.data);
        
        //Adiciona novo bloco
        addBlock(newBlock);

        //Depois de adicionar ele avia a todos os nodes que foi incluido um novo 
        // bloco enviando o novo bloco junto
        broadcast(responseLatestMsg());
        console.log('block added: ' + JSON.stringify(newBlock));

        //Pronto bloco adicionado
        res.send();
    });
    app.get('/peers', (req, res) => {
        //Os peers são os caras que controlam os nodes, por isso o blockchain é 
        // descentralizado
        //Eles estão armazenados em um array chamado sockets.
        //O get apenas retorna os dados deles. 
        res.send(sockets.map(s => s._socket.remoteAddress + ':' + s._socket.remotePort));
    });
    app.post('/addPeer', (req, res) => {
        //Você pode adicionar um novo peer
        connectToPeers([req.body.peer]);
        res.send();
    });
    app.listen(http_port, () => console.log('Listening http on port: ' + http_port));
};


var initP2PServer = () => {
    var server = new WebSocket.Server({port: p2p_port});
    server.on('connection', ws => initConnection(ws));
    console.log('listening websocket p2p port on: ' + p2p_port);

};

var initConnection = (ws) => {
    //Iniciar um peer é incluir ele no socket
    sockets.push(ws);
    //Colocar o socket ouvindo as mensagens
    initMessageHandler(ws);
    //Aqui ele fica ouvindo erros, ele apenas remove o ws do socket
    // por isso não vou nem entrar no metodo.
    initErrorHandler(ws);

    //Depois de conectado ele vai pedir o último bloco do blockchain
    write(ws, queryChainLengthMsg());
};

var initMessageHandler = (ws) => {
    //Aqui é onde a gente consegue ver como os peers se comunicam.
    //Para quem já fez algum chat com WS fica fácil de entender.
    //Para quem nunca fez: 
    //Cada mensagem tem um typo, o tipo defini o que o peer mandou e 
    // baseado nisso o que o servidor deve fazer.
    // QUERY_LATEST: Pede para o peer enviar o seu último bloco.
    // QUERY_ALL: Pede para o peer enviar todo o seu chain
    // RESPONSE_BLOCKCHAIN: Diz para o peer que ele está recebendo uma resposta 
    //  de uma solicitação que ele fez.
    // O metodo 'write' envia a resposta solicitada.
    ws.on('message', (data) => {
        var message = JSON.parse(data);
        console.log('Received message' + JSON.stringify(message));
        switch (message.type) {
            case MessageType.QUERY_LATEST:
                write(ws, responseLatestMsg());
                break;
            case MessageType.QUERY_ALL:
                write(ws, responseChainMsg());
                break;
            case MessageType.RESPONSE_BLOCKCHAIN:
                handleBlockchainResponse(message);
                break;
        }
    });
};

var initErrorHandler = (ws) => {
    var closeConnection = (ws) => {
        console.log('connection failed to peer: ' + ws.url);
        sockets.splice(sockets.indexOf(ws), 1);
    };
    ws.on('close', () => closeConnection(ws));
    ws.on('error', () => closeConnection(ws));
};


var generateNextBlock = (blockData) => {
    //O processo de gerar um bloco consiste em:

    //pega o último bloco
    var previousBlock = getLatestBlock();
    //soma mais um na PK
    var nextIndex = previousBlock.index + 1;
    //gera o timestamp
    var nextTimestamp = new Date().getTime() / 1000;
    //calcula o hash do bloco a ser adicionado
    var nextHash = calculateHash(nextIndex, previousBlock.hash, nextTimestamp, blockData);
    //retorna o blocl
    return new Block(nextIndex, previousBlock.hash, nextTimestamp, blockData, nextHash);
};


var calculateHashForBlock = (block) => {
    return calculateHash(block.index, block.previousHash, block.timestamp, block.data);
};

var calculateHash = (index, previousHash, timestamp, data) => {
    //Calculo simples de SHA256.
    return CryptoJS.SHA256(index + previousHash + timestamp + data).toString();
};

var addBlock = (newBlock) => {
    //para adicionar ele precisa validar o novo bloco.
    if (isValidNewBlock(newBlock, getLatestBlock())) {
        //Se tudo estiver válido então ele adiciona o bloco no array
        blockchain.push(newBlock);
    }
};

var isValidNewBlock = (newBlock, previousBlock) => {
    //previousBlock = a o último bloco do blockchain

    //Algumas coisas precisam ser validadas aqui:

    if (previousBlock.index + 1 !== newBlock.index) {       
        //Primeiro se o index está correto.
        console.log('invalid index');
        return false;
    } else if (previousBlock.hash !== newBlock.previousHash) {
        //O hash do bloco anterior deve ser igual ao ao último bloco do blockchain
        console.log('invalid previoushash');
        return false;
    } else if (calculateHashForBlock(newBlock) !== newBlock.hash) {
        //Ele recalcula o novo hash do bloco novo para saber se está correto
        console.log(typeof (newBlock.hash) + ' ' + typeof calculateHashForBlock(newBlock));
        console.log('invalid hash: ' + calculateHashForBlock(newBlock) + ' ' + newBlock.hash);
        return false;
    }

    // Se tudo der certo ele retorna verdadeiro 
    return true;
};

var connectToPeers = (newPeers) => {
    newPeers.forEach((peer) => {
        //Para cada novo peer ele criar um WS
        var ws = new WebSocket(peer);
        //Aqui quando a conecção do socket abrir ele vai fazer o init
        ws.on('open', () => initConnection(ws));
        //Caso de error ele só loga.
        ws.on('error', () => {
            console.log('connection failed')
        });
    });
};

//Aqui é a lógica para tratar as respostas recebidas dos outros peer do blockchain
var handleBlockchainResponse = (message) => {
    //Pega os blocos recebidos
    var receivedBlocks = JSON.parse(message.data).sort((b1, b2) => (b1.index - b2.index));
    
    //Pega o último bloco dos blocos recebidos
    var latestBlockReceived = receivedBlocks[receivedBlocks.length - 1];

    //Pega o último bloco dele mesmo
    var latestBlockHeld = getLatestBlock();

    //Verifica qual blockchain é maior, o meu ou o recebido
    if (latestBlockReceived.index > latestBlockHeld.index) {

        //Caso eu receba um blockchain maior que o meu eu tenho que me atualizar
        console.log('blockchain possibly behind. We got: ' + latestBlockHeld.index + ' Peer got: ' + latestBlockReceived.index);
        if (latestBlockHeld.hash === latestBlockReceived.previousHash) {
            //Se o hash do meu último blocl for igual ao hash do bloco anterior 
            // do último bloco recebido quer dizer que tudo para trás está igual
            // e eu apenas tenho que incluir o novo bloco
            console.log("We can append the received block to our chain");

            //Adiciono o último bloco aqui.
            blockchain.push(latestBlockReceived);

            //Toda vez que isso acontece o peer que foi atualizado envia o último
            // bloco dele para todos os outros peers atravez de um broadcast
            broadcast(responseLatestMsg());

        } else if (receivedBlocks.length === 1) {

            //Aqui acontece quando o peer é novo, ele pede o último bloco.
            // e recebe um chain com o último hash diferente do meu último hash
            // e o total de bocos recebidos é 1, o que quer dizer que eu pedi o último
            // isso garante que eu sou o novo e tenho que pedor todos os blocos.
            console.log("We have to query the chain from our peer");
            broadcast(queryAllMsg());
        } else {

            //Se cair aqui é proque o blockchain recebido é maior que o meu, então
            // eu vou me atualizar com o que veio atravéz do replaceChain
            console.log("Received blockchain is longer than current blockchain");
            replaceChain(receivedBlocks);
        }
    } else {
        //Se o index for igual ou maior ele não tem que fazer nada, já está atualizado
        console.log('received blockchain is not longer than received blockchain. Do nothing');
    }
};

var replaceChain = (newBlocks) => {
    //Ele tem que validar o blockchain recebido antes de atualizar
    // e isso é feito pela isValidChain e novamente testando o tamanho do bloco
    // atual contra o recebido.
    if (isValidChain(newBlocks) && newBlocks.length > blockchain.length) {
        console.log('Received blockchain is valid. Replacing current blockchain with received blockchain');
        blockchain = newBlocks;
        //Depois de atualizar ele envia um broadcast para todo mundo com o último bloco
        broadcast(responseLatestMsg());
    } else {
        console.log('Received blockchain invalid');
    }
};

var isValidChain = (blockchainToValidate) => {
    //O teste de validade aqui é para saber se o genesis dos dois está correto
    if (JSON.stringify(blockchainToValidate[0]) !== JSON.stringify(getGenesisBlock())) {
        return false;
    }

    //Depois ele pega cada bloco e fazer a validação de hash que vimos na inclusão de um 
    // novo bloco
    var tempBlocks = [blockchainToValidate[0]];
    for (var i = 1; i < blockchainToValidate.length; i++) {
        if (isValidNewBlock(blockchainToValidate[i], tempBlocks[i - 1])) {
            tempBlocks.push(blockchainToValidate[i]);
        } else {
            return false;
        }
    }
    return true;
};

// pegar o último bloco é apenas pegar o último do array
var getLatestBlock = () => blockchain[blockchain.length - 1];

//Monta uma solicitação para pegar o último bloco do blockchain
var queryChainLengthMsg = () => ({'type': MessageType.QUERY_LATEST});

//Monta uma solicitação para pegar todos os blocos do blockchain
var queryAllMsg = () => ({'type': MessageType.QUERY_ALL});

//Monta uma resposta do tipo RESPONSE_BLOCKCHAIN com todos os blocos
var responseChainMsg = () =>({
    'type': MessageType.RESPONSE_BLOCKCHAIN, 'data': JSON.stringify(blockchain)
});

//Monta uma resposta do tipo RESPONSE_BLOCKCHAIN com o último bloco.
var responseLatestMsg = () => ({
    'type': MessageType.RESPONSE_BLOCKCHAIN,
    'data': JSON.stringify([getLatestBlock()])
});

//Envia uma resposta pelo WS
var write = (ws, message) => ws.send(JSON.stringify(message));
var broadcast = (message) => sockets.forEach(socket => write(socket, message));

connectToPeers(initialPeers);
initHttpServer();
initP2PServer();