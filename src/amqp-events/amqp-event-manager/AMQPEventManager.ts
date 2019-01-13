import amqp = require('amqplib/callback_api');

import { EMServiceSession } from '../../express-mongoose/emServiceSession/emServiceSession';
import { AMQPDelegate } from '../amqp-delegate/AMQPDelegate';
import { AMQPEvent } from '../amqp-event/AMQPEvent';
import { AMQPEventMessage } from '../amqp-models/amqp-models';
import { AMQPSender } from '../amqp-sender/AMQPSender';
import { AMQPEventArgs } from '../amqp-event-args/AMQPEventArgs';
import { EMSession } from '../../express-mongoose/emSession/emSession';

interface QueueBindDescription
{
    name: string,
    exchangeName: string,
    routingKey : string,
    exclusive : boolean
}

interface ExchangeDescription
{
    name: string,
    type: ExchangeType,
    durable: boolean
}

enum ExchangeType
{
    topic = 'topic',
    fanout = 'fanout',
    direct = 'direct'
}

class AMQPEventManager
{
    //#region Properties
    
    private _serviceSession : EMServiceSession;

    private _events : Array<{ name: string, instance : AMQPEvent }>;
    private _delegates : Array<{ name: string, instance : AMQPDelegate}>;
    private _channels : Array<{ name: string, instance: amqp.Channel}>;

    private _exchangesDescription : Array<ExchangeDescription>;
    //#endregion

    //#region Methods

    constructor( serviceSession : EMServiceSession )
    {
        this._serviceSession = serviceSession;

        this._events = new Array<{name: string, instance : AMQPEvent}>();
        this._delegates = new Array<{name: string, instance: AMQPDelegate}>();
        this._exchangesDescription = new Array<ExchangeDescription>();
    }

    registerEvent<TEvent extends AMQPEvent>( type: { new( session: AMQPEventManager) : TEvent } ) : TEvent
    {
        this._serviceSession.checkAMQPConnection();

        let instance = new type(this);
        if (instance.exchangeDescription)
            this.verifyExchageDescription(instance.exchangeDescription);

        this._events.push({ name: type.name, instance });

        return instance;
    }

    publish( eventName: string, data : any) : void;
    publish( eventName: string, data : any, options: { session? : EMSession, entityName?: string, actionName?: string, entityId?: string } ) : void;
    publish( eventName: string, data : any, options?: { session? : EMSession, entityName?: string, actionName?: string, entityId?: string } ) : void
    {
        this._serviceSession.checkAMQPConnection();

        let pub = this._events.find( p => p.name == eventName);

        if (!pub)
            this._serviceSession.throwException(`No registered event for: ${eventName}`);

        pub.instance.constructMessage( data, options ).then( amqpMessage => {
            let message = {
                sender: amqpMessage.sender.serialize(),
                eventArgs: amqpMessage.eventArgs.serialize()
            };
    
            this.assertEventChannel(pub.instance).then( c => {
                let content = new Buffer(JSON.stringify(message));
    
                if (!pub.instance.specificQueue)
                    c.publish( pub.instance.exchangeDescription.name, pub.instance.routingKey, content, amqpMessage.sender.publishOptions );
                else
                    c.sendToQueue( pub.instance.specificQueue, content, amqpMessage.sender.publishOptions );

            });
        });
    }

    registerDelegate<TDelegate extends AMQPDelegate>( type: { new( session: AMQPEventManager) : TDelegate } ) : TDelegate
    {
        this._serviceSession.checkAMQPConnection();

        let instance = new type(this);
        this._delegates.push( { name: type.name, instance } );
        this.assertDelegateChannel(instance).then( ch => {
            ch.assertQueue(instance.queueName, instance.queueOptions);
            ch.consume(instance.queueName, instance.onMessage(ch) ) 
        });

        return instance;
    }

    assertDelegateChannel( delegate : AMQPDelegate ) : Promise<amqp.Channel>
    {
        return this.assertChannel(delegate.channelName).then( channelResult => channelResult.channel );
    };

    assertEventChannel( event : AMQPEvent ) : Promise<amqp.Channel>
    {
        return this.assertChannel(event.channelName).then( 
            channelResult => {
                if (channelResult.isNew && !event.specificQueue && event.exchangeDescription)
                    channelResult.channel.assertExchange( event.exchangeDescription.name, event.exchangeDescription.type, { durable: event.exchangeDescription.durable} );

                return channelResult.channel
            }
        );
    }

    createAnonymousChannel() : Promise<amqp.Channel>
    {
        return this.assertChannel(null).then( channelResult => channelResult.channel );
    }

    private assertChannel( name : string ) : Promise<{ channel : amqp.Channel, isNew : boolean }>
    {
        return new Promise<{ channel : amqp.Channel, isNew : boolean }>( (resolve,reject)=>{
    
            if (name)
                var ch = this._serviceSession.brokerChannels.find( c => c.name == name );
            
            if (!ch)
            {
                this._serviceSession.brokerConnection.createChannel( (err, channel)=>{
                    if (!err)
                    {
                        this._serviceSession.brokerChannels.push( { name, instance: channel } );
                        resolve({ channel, isNew: true});
                    }
                    else
                        reject(err);
                });
            } 
            else
                resolve({ channel: ch.instance, isNew: false });
        });
    }

    private verifyExchageDescription( exchangeDescription : ExchangeDescription ) : void
    {
        let existingExchange = this._exchangesDescription.find( e => e.name == exchangeDescription.name );

        if (existingExchange)
        {
            let inconsistence = false;
            for ( let p in existingExchange )
            {
                if ( existingExchange[p] != exchangeDescription[p] )
                    inconsistence = true;
            }

            if (inconsistence)
                this.serviceSession.throwException(`There are inconsistences with the exchange '${exchangeDescription.name}'. Please check if all connections are using it in the same way`);
        }
        else
            this._exchangesDescription.push( exchangeDescription );
    }

    defineExchange( exchangeDescription : ExchangeDescription ) : void
    {
        this.verifyExchageDescription(exchangeDescription);
    }
    
    getExchangeDescription( exchangeName ) : ExchangeDescription
    {
        let e = this._exchangesDescription.find( e => e.name == exchangeName );

        if (!e)
            this.serviceSession.throwException(`There is no defined exchange with name '${exchangeName}'`);

        return e;
    }

    //#endregion

    //#region Accesors
    
    get serviceSession()
    { return this._serviceSession }

    //#endregion
}

export { AMQPEventManager, ExchangeDescription, ExchangeType }