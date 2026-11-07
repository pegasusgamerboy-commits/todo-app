import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3000;

app.use(express.json());

const AWS_REGION = process.env.AWS_REGION;
const TABLE_NAME = process.env.TABLE_NAME;

if (!AWS_REGION) {
  console.error('Error: AWS_REGION environment variable is not set.');
  process.exit(1);
}
if (!TABLE_NAME) {
  console.error('Error: TABLE_NAME environment variable is not set.');
  process.exit(1);
}

const client = new DynamoDBClient({ region: AWS_REGION });
const db = DynamoDBDocumentClient.from(client);

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).send('ok');
});

// Get all todos
app.get('/todos', async (req, res) => {
  try {
    const params = {
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': 'TODO',
      },
    };
    const { Items } = await db.send(new QueryCommand(params));
    res.json(Items.map(item => ({
      id: item.sk.substring('ITEM#'.length),
      content: item.content,
      completed: item.completed,
      createdAt: item.createdAt,
    })));
  } catch (error) {
    console.error('Failed to get todos:', error);
    res.status(500).json({ error: 'Failed to retrieve todos' });
  }
});

// Add a new todo
app.post('/todos', async (req, res) => {
  try {
    const { content } = req.body;
    if (!content || typeof content !== 'string' || content.trim() === '') {
      return res.status(400).json({ error: 'Todo content is required' });
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const params = {
      TableName: TABLE_NAME,
      Item: {
        pk: 'TODO',
        sk: 'ITEM#' + id,
        content: content.trim(),
        completed: false,
        createdAt: now,
      },
    };
    await db.send(new PutCommand(params));
    res.status(201).json({ id: id, content: content.trim(), completed: false, createdAt: now });
  } catch (error) {
    console.error('Failed to add todo:', error);
    res.status(500).json({ error: 'Failed to add todo' });
  }
});

// Update a todo (e.g., toggle completion)
app.put('/todos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { content, completed } = req.body;

    if (typeof content === 'undefined' && typeof completed === 'undefined') {
      return res.status(400).json({ error: 'No update parameters provided' });
    }

    const updateExpressionParts = [];
    const expressionAttributeValues = {};
    const expressionAttributeNames = {};

    if (typeof content === 'string' && content.trim() !== '') {
      updateExpressionParts.push('SET #content = :content');
      expressionAttributeValues[':content'] = content.trim();
      expressionAttributeNames['#content'] = 'content';
    }
    if (typeof completed === 'boolean') {
      updateExpressionParts.push('SET #completed = :completed');
      expressionAttributeValues[':completed'] = completed;
      expressionAttributeNames['#completed'] = 'completed';
    }

    if (updateExpressionParts.length === 0) {
      return res.status(400).json({ error: 'Invalid update parameters' });
    }

    const params = {
      TableName: TABLE_NAME,
      Key: {
        pk: 'TODO',
        sk: 'ITEM#' + id,
      },
      UpdateExpression: updateExpressionParts.join(', '),
      ExpressionAttributeValues: expressionAttributeValues,
      ExpressionAttributeNames: expressionAttributeNames,
      ReturnValues: 'ALL_NEW',
    };

    const { Attributes } = await db.send(new UpdateCommand(params));
    if (!Attributes) {
      return res.status(404).json({ error: 'Todo not found' });
    }
    res.json({
      id: Attributes.sk.substring('ITEM#'.length),
      content: Attributes.content,
      completed: Attributes.completed,
      createdAt: Attributes.createdAt,
    });
  } catch (error) {
    console.error('Failed to update todo:', error);
    res.status(500).json({ error: 'Failed to update todo' });
  }
});

// Delete a todo
app.delete('/todos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const params = {
      TableName: TABLE_NAME,
      Key: {
        pk: 'TODO',
        sk: 'ITEM#' + id,
      },
    };
    await db.send(new DeleteCommand(params));
    res.status(204).send(); // No content
  } catch (error) {
    console.error('Failed to delete todo:', error);
    res.status(500).json({ error: 'Failed to delete todo' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:' + PORT);
});
